require "rails_helper"

# KubeJobClient must launch the EKS bulk-download Job reliably: the apiserver occasionally answers a
# submit with a transient failure (connection reset, read timeout, 5xx during a control-plane roll,
# 429 priority-throttle), and a retry can race a submit that actually landed. These specs pin the
# two guarantees that make the EKS path "work every single time" (SMP-1477): transient retries with
# backoff, and idempotent adoption of an already-created Job on 409 AlreadyExists.
RSpec.describe KubeJobClient do
  # No-op sleeper so tests never actually block on backoff. Zero-out the delays too.
  let(:no_sleep) { ->(_seconds) {} }
  let(:retry_opts) { { base_delay: 0, max_delay: 0, jitter: 0, sleeper: no_sleep } }

  let(:manifest) { { metadata: { name: "bulk-download-42" }, spec: {} } }
  let(:job_body) { { "metadata" => { "name" => "bulk-download-42" } }.to_json }
  let(:job_hash) { { "metadata" => { "name" => "bulk-download-42" } } }

  let(:client) { described_class.new }

  before do
    # The client reads the pod ServiceAccount token/namespace at construction; outside a pod those
    # files don't exist, so stub just those two reads and build a client without a real filesystem.
    allow(File).to receive(:read).and_call_original
    allow(File).to receive(:read).with("#{KubeJobClient::SA_DIR}/token").and_return("fake-token\n")
    allow(File).to receive(:read).with("#{KubeJobClient::SA_DIR}/namespace").and_return("seqtoid-web\n")
  end

  # Build a canned Net::HTTPResponse of the given subclass with a fixed body. Class identity is what
  # create_job's case/when and RETRYABLE_STATUS both key on, so real subclasses (not doubles) are used.
  def http_response(klass, code, body)
    res = klass.new("1.1", code, "")
    allow(res).to receive(:body).and_return(body)
    res
  end

  describe "#create_job" do
    it "returns the created Job on a 2xx without retrying" do
      created = http_response(Net::HTTPCreated, "201", job_body)
      expect(client).to receive(:request).once.and_return(created)

      expect(client.create_job(manifest, **retry_opts)).to eq(job_hash)
    end

    it "retries a transient 503 and then succeeds" do
      unavailable = http_response(Net::HTTPServiceUnavailable, "503", "apiserver rolling")
      created = http_response(Net::HTTPCreated, "201", job_body)
      expect(client).to receive(:request).exactly(3).times.and_return(unavailable, unavailable, created)

      expect(client.create_job(manifest, **retry_opts)).to eq(job_hash)
    end

    it "retries a 429 priority-throttle and then succeeds" do
      throttled = http_response(Net::HTTPTooManyRequests, "429", "priority throttled")
      created = http_response(Net::HTTPCreated, "201", job_body)
      expect(client).to receive(:request).exactly(2).times.and_return(throttled, created)

      expect(client.create_job(manifest, **retry_opts)).to eq(job_hash)
    end

    it "retries a transient transport error (read timeout) and then succeeds" do
      created = http_response(Net::HTTPCreated, "201", job_body)
      calls = 0
      allow(client).to receive(:request) do
        calls += 1
        raise Net::ReadTimeout if calls < 3

        created
      end

      expect(client.create_job(manifest, **retry_opts)).to eq(job_hash)
      expect(calls).to eq(3)
    end

    it "does NOT retry a permanent 403 and surfaces the apiserver body" do
      forbidden = http_response(Net::HTTPForbidden, "403", "jobs.batch is forbidden: RBAC")
      expect(client).to receive(:request).once.and_return(forbidden)

      expect { client.create_job(manifest, **retry_opts) }
        .to raise_error(KubeJobClient::Error, /403.*forbidden/i)
    end

    it "raises a typed Error after exhausting retries on a persistent transport failure" do
      expect(client).to receive(:request).exactly(KubeJobClient::DEFAULT_MAX_ATTEMPTS).times.and_raise(Errno::ECONNRESET)

      expect { client.create_job(manifest, **retry_opts) }
        .to raise_error(KubeJobClient::Error, /failed after #{KubeJobClient::DEFAULT_MAX_ATTEMPTS} attempt/i)
    end

    it "sleeps between retries using the injected sleeper" do
      slept = []
      sleeper = ->(seconds) { slept << seconds }
      unavailable = http_response(Net::HTTPServiceUnavailable, "503", "rolling")
      created = http_response(Net::HTTPCreated, "201", job_body)
      allow(client).to receive(:request).and_return(unavailable, created)

      client.create_job(manifest, base_delay: 0.5, max_delay: 8, jitter: 0, sleeper: sleeper)

      expect(slept.length).to eq(1)
      expect(slept.first).to be_within(0.001).of(0.5)
    end

    context "idempotent adopt on 409 AlreadyExists" do
      it "adopts the already-running Job by GETting it, so a submit that really landed is never reported failed" do
        conflict = http_response(Net::HTTPConflict, "409", 'jobs.batch "bulk-download-42" already exists')
        got = http_response(Net::HTTPOK, "200", job_body)
        expect(client).to receive(:request).with(Net::HTTP::Post, anything, anything).once.and_return(conflict)
        expect(client).to receive(:request).with(Net::HTTP::Get, %r{/jobs/bulk-download-42\z}, nil).once.and_return(got)

        expect(client.create_job(manifest, **retry_opts)).to eq(job_hash)
      end

      it "raises if a 409 comes back but the manifest carries no name to adopt" do
        conflict = http_response(Net::HTTPConflict, "409", "already exists")
        allow(client).to receive(:request).and_return(conflict)

        expect { client.create_job({ metadata: {} }, **retry_opts) }
          .to raise_error(KubeJobClient::Error, /no metadata.name to adopt/i)
      end
    end
  end

  describe "#get_job" do
    it "raises a typed Error when the Job cannot be fetched" do
      not_found = http_response(Net::HTTPNotFound, "404", "not found")
      expect(client).to receive(:request).once.and_return(not_found)

      expect { client.get_job("bulk-download-42", **retry_opts) }
        .to raise_error(KubeJobClient::Error, /get job bulk-download-42 -> 404/)
    end
  end
end
