# CI base image for the MySQL 8 Ruby test gate (SMP-1579).
#
# Pre-bakes the apt (system) + pip (python) deps that bin/ci-test otherwise installs COLD on
# every one of the x8 ci-test-mysql8 shard runners (~162s of fixed per-shard overhead, mostly
# compiling biom-format's C extension). With these baked into image layers, each shard skips the
# apt+pip groups (bin/ci-test gates them on the CI_TEST_PREBAKED marker set at the bottom) and
# pays only bundle-restore + schema-load + rspec.
#
# Consumed by:   .github/workflows/ci-test-mysql8.yml  (shard jobs' container:)
# Built/pushed:  .github/workflows/ci-test-base-image.yml
#
# KEEP IN SYNC WITH bin/ci-test: the apt package set and the pip steps/pins below MUST match
# bin/ci-test's non-prebaked path byte-for-byte. bin/ci-test fail-closes (errors, does not
# silently proceed) if CI_TEST_PREBAKED is set but a baked tool is missing, so a drift here is
# caught rather than shipped.
#
# REFRESH: the build workflow's paths filter fires on any change to requirements.txt /
# Gemfile.lock / this Dockerfile and tags the image by a content hash of them, so a pin bump
# auto-publishes a new image (and moves :latest, which ci-test-mysql8 pulls).
#
# amd64-only build (see the build workflow platforms): some Python wheels (biom-format) have no
# arm64 build -- matching bin/ci-test and Dockerfile.test -- and the GitHub-hosted runners are amd64.
FROM ruby:3.3.6

# System deps -- identical set to bin/ci-test's apt line (keep in sync). --no-install-recommends +
# apt-lists cleanup keep the layer lean; versions are intentionally UNPINNED to match bin/ci-test's
# unpinned apt install byte-for-byte (the fail-closed check in bin/ci-test guards contents).
# hadolint ignore=DL3008
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     python3-pip python3-dev build-essential nodejs default-mysql-client default-libmysqlclient-dev \
  && rm -rf /var/lib/apt/lists/*
RUN pip3 config set global.break-system-packages true

WORKDIR /app

# Python deps -- same steps + pins as bin/ci-test's Python group. requirements.txt is the only
# build-context file this image needs; its content (plus Gemfile.lock + this Dockerfile) is what
# the build workflow hashes into the image tag, so a pin bump rebuilds the image.
# hadolint ignore=DL3013
COPY requirements.txt ./
RUN pip3 install --upgrade pip \
  && pip3 install "cython<3.0.0" \
  && pip3 install "pyyaml==5.4.1" --no-build-isolation \
  && pip3 install -r requirements.txt

# PREBAKED marker: bin/ci-test reads CI_TEST_PREBAKED and SKIPS the apt+pip groups when it is set.
# Local/serial runs (bin/ci-local, docker-compose.ci.yml on bare ruby:3.3.6) leave it unset and
# install normally, so the SSOT script still works everywhere. bin/ci-test additionally verifies
# the baked tools are actually present before trusting this marker (fail-closed).
ENV CI_TEST_PREBAKED=1
