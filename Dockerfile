# syntax=docker/dockerfile:1
# =============================================================================
# The `# syntax` line above enables BuildKit `RUN --mount=type=cache` (#463): the
# npm + bundler DOWNLOAD caches persist across local rebuilds so a Gemfile.lock /
# package-lock change re-downloads only what changed instead of the whole set.
# Build-time only — the cache dirs are NOT baked into the image (installed gems in
# /usr/local/bundle/gems + node_modules ARE). Needs DOCKER_BUILDKIT=1 (the Makefile
# and buildx set it). In CI the mounts are empty per run (harmless); the win is local.
# =============================================================================
# Multi-stage build (EOL image hardening, #251-255/#346): compile everything in a
# full-toolchain `builder` stage, then ship a slim `runtime` stage carrying ONLY
# the runtime deps + built artifacts. Drops build-essential, all `-dev` headers,
# the C/C++ toolchain, and node from the shipped image — the bulk of the Trivy
# HIGH/CRITICAL CVEs (the ~1354 came from the full Debian base + build packages).
#
# Both stages are Debian bookworm on ruby 3.3.6, so the gems + python extensions
# compiled in `builder` are ABI-compatible when copied into `runtime`.
#
# WARNING: RUNTIME NOT YET VALIDATED end-to-end (the container booting + serving) —
# that needs a dev smoke once the EKS/Argo dev cluster is up. This pass proves the
# build assembles and the CVE count drops; runtime acceptance is the follow-up gate.
# =============================================================================

# ---------- builder: full toolchain (unchanged from the single-stage image) ----------
# bug-#001/#004: Ruby 3.1.6 (EOL) -> 3.3.6, pinned by multi-arch digest.
#
# #482 (multi-arch amd64+arm64): the digest above is a MANIFEST LIST, so buildx selects
# the right per-arch ruby base automatically. buildx also injects the TARGETARCH build-arg
# (`amd64`|`arm64`) into any stage that declares it — used below to fetch the correct
# per-arch prebuilt binaries (node, chamber, mysql client).
# chamber built from source with a CURRENT Go toolchain (#674 / #474). segmentio's prebuilt
# release binaries lag on Go and carry Go-stdlib CVEs -- even chamber v3.1.5 ships built with
# Go 1.25.6, still exposed to CVE-2026-39822 (fixed in Go 1.25.12+). The floating golang:1.25
# tag tracks the latest 1.25.x patch (>= 1.25.12), so this clears it and keeps clearing future
# Go-stdlib CVEs on rebuild. The stage runs natively per target platform, so `go install`
# builds the correct per-arch binary (amd64/arm64) with no extra flags.
FROM golang:1.25 AS chamber-builder
RUN CGO_ENABLED=0 GOBIN=/out go install github.com/segmentio/chamber/v3@v3.1.5

FROM ruby:3.3.6@sha256:347edd0c70ee08d87de9f01b99de2f14a64cedb5d1bfb38457dfe8cd0bf113c5 AS builder

# buildx-provided target arch of the image being built: `amd64` or `arm64`.
ARG TARGETARCH

RUN apt-get update && apt-get upgrade -y && \
  apt-get install -y \
  build-essential \
  default-libmysqlclient-dev \
  python3-dev \
  python3-pip \
  lsb-release \
  apt-transport-https

# samtools 1.17 (apt's 1.9 lacks the -X flag the AMR download service needs).
# #78: download to a file and verify its SHA256 before extracting, so a compromised or
# corrupted tarball fails the build instead of being compiled + installed silently. -f makes
# curl fail on an HTTP error (previously a 404/500 body could be piped into tar). The SHA256
# is the official samtools 1.17 GitHub release asset.
RUN curl -fsSL -o samtools-1.17.tar.bz2 \
  https://github.com/samtools/samtools/releases/download/1.17/samtools-1.17.tar.bz2 \
  && echo "3adf390b628219fd6408f14602a4c4aa90e63e18b395dad722ab519438a2a729  samtools-1.17.tar.bz2" | sha256sum -c - \
  && tar xjf samtools-1.17.tar.bz2 \
  && cd samtools-1.17/ && make && make install \
  && cd .. && rm -rf samtools-1.17 samtools-1.17.tar.bz2

# node pinned to .node-version (CZID-197) — build-time only (webpack); NOT shipped.
# #482: node's release assets use `x64`/`arm64` (not Docker's `amd64`/`arm64`), so map
# TARGETARCH -> node's arch token.
COPY .node-version /tmp/.node-version
RUN NODE_VERSION="$(cat /tmp/.node-version)" \
  && case "${TARGETARCH}" in \
       amd64) NODE_ARCH=x64 ;; \
       arm64) NODE_ARCH=arm64 ;; \
       *) echo "unsupported TARGETARCH=${TARGETARCH}" >&2; exit 1 ;; \
     esac \
  && curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.gz" \
  && tar -xzf "node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.gz" -C /usr/local --strip-components=1 --no-same-owner \
  && rm "node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.gz" \
  && node --version && npm --version
RUN npm i -g npm@11.16.0

RUN pip3 config set global.break-system-packages true
RUN pip3 install --upgrade pip

# chamber is built from source in the `chamber-builder` stage below (see top of file) and
# copied into the runtime stage -- so it inherits a current Go toolchain instead of
# segmentio's prebuilt release binary, which lags on Go and carried Go-stdlib CVEs
# (#674: CVE-2026-39822 was unfixed even in the v3.1.5 prebuilt / Go 1.25.6). #474.

COPY requirements.txt ./
RUN pip3 install "cython<3.0.0"
RUN pip3 install "pyyaml==5.4.1" --no-build-isolation
RUN pip3 install -r requirements.txt

WORKDIR /app

# .npmrc carries legacy-peer-deps=true (bug-#003) — must precede `npm ci`.
COPY .npmrc package.json package-lock.json ./
# #463: cache npm's download store across builds so a package-lock change re-fetches
# only new tarballs. node_modules is still installed fresh into the image.
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci --omit=optional

# Generate the app's static resources (webpack). 6GB heap for node.
ENV NODE_OPTIONS="--max_old_space_size=6144"
COPY app/assets app/assets
COPY webpack.config.common.js webpack.config.prod.js .babelrc ./
# CZID-380: cache-bust the asset build on any frontend source/config change.
ARG SRC_HASH=unset
RUN echo "asset source hash: ${SRC_HASH}"
RUN mkdir -p app/assets/dist && npm run build-img && ls -l app/assets/dist/

# RubyGems (.ruby-version needed: Gemfile pins `ruby file: '.ruby-version'`).
COPY Gemfile Gemfile.lock .ruby-version ./
RUN gem install bundler -v '2.5.22'
RUN bundle config set force_ruby_platform true
# #463: cache the downloaded .gem archives (/usr/local/bundle/cache) across builds so
# a Gemfile.lock change re-downloads only new gems. Installed gems still land in
# /usr/local/bundle/gems (in the image); only the download cache is mount-excluded.
RUN --mount=type=cache,target=/usr/local/bundle/cache,sharing=locked bundle install --jobs 20 --retry 5

COPY . ./
ARG GIT_COMMIT
ENV GIT_VERSION=${GIT_COMMIT}

# #544: Precompile the Sprockets assets (application.css et al.) into public/assets so the
# runtime image ships them. In the deployed envs config.assets.compile is off (prod.rb line 49
# commented; dev has the check disabled), so without precompiled assets the server-rendered
# landing page 500s with Sprockets::Rails::Helper::AssetNotPrecompiledError (HomeController#
# landing). This runs AFTER `npm run build-img`, so the webpack dist bundles that application.css
# `//= require`s already exist.
#
# Boot env for the precompile:
#  - RAILS_ENV=development : the env this deployed image actually boots + serves as (bin/deploy
#    maps dev->development, and DEV is where the app runs and where the Sentry 500s fired). It is
#    the runtime-validated env and boots cleanly here: its redis cache_store + session_store are
#    inside an `if tmp/caching-dev.txt exists` block (false in the build -> null_store), so no
#    REDISCLOUD_URL is needed and no config-method assignment fails. NOT `production` -- this app
#    has no `production` DB config (envs: development/deployed/prod/staging/sandbox), which is why
#    the earlier attempt (#204) died with ActiveRecord::AdapterNotSpecified. NOT `prod` either:
#    prod.rb is not yet runtime-validated and aborts boot on latent bugs (ENV['REDISCLOUD_URL']
#    + '/0/cache' with no redis var; `config.session_store =` is a removed setter in Rails 7.1).
#    The Sprockets manifest written under public/assets is read env-agnostically at serve time --
#    content-hashed digests, asset_host applied at render time -- so the same precompiled assets
#    serve every tier (dev/staging/sandbox/prod) once those prod.rb boot bugs are fixed.
#  - assets:precompile is a rake task, so Rails forces config.eager_load=false -- no app models
#    are loaded, so no boot-time DB connection is attempted.
#  - DATABASE_URL : a dummy, parseable URL so the DB config resolves without the real
#    RDS_ADDRESS/DB_* env vars; precompile is lazy and never opens the connection.
#  - SECRET_KEY_BASE : a dummy value so boot never needs a real secret baked into the build.
#  - AWS_REGION/AWS_DEFAULT_REGION : precompile boots the full env, and s3.rb constructs
#    Aws::S3::Client.new at load; the AWS SDK requires a region at construction, which the
#    runtime env supplies but the build does not. A region (no credentials, no connection)
#    lets boot proceed. Value mirrors the app's us-west-2 home region.
#  - ASSETS_PRECOMPILE=1 : a build-only marker (never set at runtime) read by
#    config/initializers/elasticsearch.rb to SKIP wiring the live search client -- the
#    OpensearchCircuit wrapper is not needed to compile assets and pulling it in at build
#    time is avoidable. Runtime behavior is unchanged because the flag is absent there.
RUN SECRET_KEY_BASE=dummydummydummydummydummydummydummydummydummydummydummydummy \
  DATABASE_URL="mysql2://u:p@127.0.0.1/dummy" \
  AWS_REGION=us-west-2 \
  AWS_DEFAULT_REGION=us-west-2 \
  ASSETS_PRECOMPILE=1 \
  RAILS_ENV=development \
  bundle exec rails assets:precompile \
  && ls -l public/assets | head -20

# ---------- runtime: slim — only runtime deps + built artifacts ----------
# ruby:3.3.6-slim is a manifest list, so buildx picks the per-arch base automatically.
FROM ruby:3.3.6-slim AS runtime

# buildx-provided target arch (`amd64`|`arm64`) — drives the MySQL-client selection below.
ARG TARGETARCH

# Runtime-only apt deps (NO compilers / -dev headers / node):
#  - libaio1 + a mysql client (provides the `mysql`/`mysqlimport` CLI binaries used by
#    lib/tasks/update_tables_for_index_gen.rake at runtime — see the per-arch note below).
#  - samtools shared libs (libncurses/libbz2/liblzma/zlib/libcurl/libdeflate).
#  - libmariadb3: the mysql2 gem's native ext links libmysqlclient (built against
#    default-libmysqlclient-dev = libmariadb-dev in builder). Already multi-arch.
#  - python3 runtime (the app shells out to python/awscli; awscli is pure-python pip,
#    installed in builder, so it is arch-agnostic — no per-arch binary to fetch).
#
# #482 MySQL-client per-arch caveat: Oracle's MySQL-community APT repo ships amd64 ONLY
# (there is NO arm64 build of mysql-community-client anywhere in repo.mysql.com's pool).
#  - amd64: keep today's EXACT mysql-5.7 community client .deb (byte-compatible, no
#    regression; deliberately non-MariaDB for MySQL-8 virtual-generated-column import
#    compat — see the original single-stage note).
#  - arm64: fall back to Debian's default-mysql-client (MariaDB) so arm64 pods have the
#    `mysql`/`mysqlimport` binaries and can boot + serve. CAVEAT: the MariaDB `mysqlimport`
#    is what the community client was chosen to AVOID for the index-gen rake's virtual-
#    generated-column import — so the taxon-index-gen rake (update_tables_for_index_gen)
#    must keep running on an AMD64 node until that import path is validated on MariaDB.
#    The web/request path does NOT use these binaries (it uses the mysql2 gem →
#    libmariadb3, already multi-arch), so arm64 web pods are unaffected.
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
  ca-certificates curl wget tzdata procps \
  libaio1 libatomic1 libnuma1 \
  libncurses6 libbz2-1.0 liblzma5 zlib1g libcurl4 libdeflate0 \
  libmariadb3 \
  python3 libyaml-0-2 \
  && if [ "${TARGETARCH}" = "amd64" ]; then \
       wget http://repo.mysql.com/apt/debian/pool/mysql-5.7/m/mysql-community/mysql-community-client_5.7.42-1debian10_amd64.deb \
       && (dpkg -i mysql-community-client*.deb || apt-get install -f -y --no-install-recommends) \
       && rm mysql-community-client*.deb ; \
     else \
       apt-get install -y --no-install-recommends default-mysql-client ; \
     fi \
  && rm -rf /var/lib/apt/lists/*

# Built artifacts from the builder stage.
COPY --from=builder /usr/local/bundle /usr/local/bundle
COPY --from=builder /usr/local/bin/samtools /usr/local/bin/samtools
COPY --from=chamber-builder /out/chamber /bin/chamber
# python packages + the pip console-script entrypoints the app shells out to (NOT
# /usr/local/bin wholesale — that would drag node back in). pip3 (break-system-packages)
# installs here on bookworm. Each shelled-out CLI needs BOTH its package (in dist-packages,
# copied above) AND its /usr/local/bin entrypoint copied explicitly:
#   - aws   : lib/s3_tar_writer.rb (S3 uploads)
#   - aegea : app/models/bulk_download.rb (aegea ecs run -> bulk-download ECS task).
#             Was missing here, so `aegea` was absent from runtime PATH and every bulk
#             download raised Errno::ENOENT (Sentry DEV-RAILS-PROJECT-23).
#   - biom  : app/models/bulk_download.rb#create_biom_file (Open3.capture3 "biom" convert/
#             add-metadata). Same failure mode as aegea: the biom-format package is in
#             dist-packages (copied above) but its console-script entrypoint was NOT copied,
#             so `biom` was absent from runtime PATH and every "Combined Microbiome File"
#             (biom_format) bulk download failed with "No such file or directory - biom".
COPY --from=builder /usr/local/lib/python3.11/dist-packages /usr/local/lib/python3.11/dist-packages
COPY --from=builder /usr/local/bin/aws /usr/local/bin/aws
COPY --from=builder /usr/local/bin/aegea /usr/local/bin/aegea
COPY --from=builder /usr/local/bin/biom /usr/local/bin/biom

WORKDIR /app
COPY --from=builder /app /app

ARG GIT_COMMIT
ENV GIT_VERSION=${GIT_COMMIT}

# Non-root hardening (#64/CZID-64): run the container as an unprivileged user instead of
# root so any RCE lands with a much smaller blast radius. The app listens on 3000 (a non-
# privileged port), so nothing here needs root at runtime. We create appuser with a FIXED
# uid/gid 10001 (stable, reproducible ownership across rebuilds) and hand it ownership of the
# only paths Rails must write at runtime:
#   - /app/tmp             : Rails cache, pids, sockets (rails server writes these on boot)
#   - /app/log             : Rails logfiles
#   - /app/app/assets/dist : webpack output (built in the builder stage); kept writable in
#                            case the app touches it at boot.
#   - /home/appuser        : HOME for the runtime user. The app shells out to the aws CLI
#                            (Python/botocore) for S3 result I/O, and the CLI needs a writable
#                            HOME for its config/cache dir. useradd --no-create-home does not
#                            make it, so we create + chown it here; otherwise every transfer
#                            dies with "[Errno 13] Permission denied: /home/appuser" and all
#                            pipeline result-loading fails (CZID-64 regression).
# The whole /app tree is chowned so the working tree is fully owned by appuser. Gems in
# /usr/local/bundle and the chamber binary at /bin/chamber stay root-owned but are world-
# readable / world-executable (COPY preserves the 0755 chmod from the builder), so appuser
# can `bundle exec` and run `chamber` without ever needing to write there.
RUN groupadd --gid 10001 appuser \
  && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin appuser \
  && mkdir -p /home/appuser /app/tmp /app/log /app/app/assets/dist \
  && chown -R appuser:appuser /app /home/appuser
USER appuser

EXPOSE 3000
ENTRYPOINT ["bin/entrypoint.sh"]
CMD ["rails", "server", "-b", "0.0.0.0", "-p", "3000"]
