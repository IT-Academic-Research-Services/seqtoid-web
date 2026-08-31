# frozen_string_literal: true

require "rails_helper"
require Rails.root.join("lib/secret_redaction").to_s

RSpec.describe SecretRedaction do
  # Obvious fakes. Nothing here is or resembles a real credential.
  let(:fake_token) { "fake-basespace-token-not-a-real-credential" }
  let(:fake_signed_url) do
    "https://basespace.example.invalid/files/sample_one.fastq.gz" \
      "?X-Amz-Signature=fakesignaturevalue&X-Amz-Credential=fakecredvalue"
  end
  let(:plain_url) { "https://api.basespace.example.invalid/v2/datasets/d1/files" }

  describe ".fingerprint" do
    it "is stable for the same input" do
      expect(described_class.fingerprint(fake_token)).to eq(described_class.fingerprint(fake_token))
    end

    it "differs for different inputs" do
      expect(described_class.fingerprint(fake_token)).not_to eq(described_class.fingerprint("#{fake_token}x"))
    end

    it "does not leak any prefix of the input" do
      digest = described_class.fingerprint(fake_token)

      expect(digest).not_to include(fake_token)
      # No prefix of the secret survives -- this is what a "first N chars" mask
      # would fail, and why we use a digest instead.
      (4..fake_token.length).each do |length|
        expect(digest).not_to include(fake_token[0, length])
      end
    end

    it "is a labelled truncated sha256" do
      expect(described_class.fingerprint(fake_token))
        .to eq("sha256:#{Digest::SHA256.hexdigest(fake_token)[0, 12]}")
    end

    it "returns nil for nil and for empty input" do
      expect(described_class.fingerprint(nil)).to be_nil
      expect(described_class.fingerprint("")).to be_nil
    end
  end

  describe ".redact_url" do
    it "keeps the origin and object path but drops the signature" do
      redacted = described_class.redact_url(fake_signed_url)

      expect(redacted).to eq("https://basespace.example.invalid/files/sample_one.fastq.gz?[REDACTED]")
      expect(redacted).not_to include("fakesignaturevalue")
      expect(redacted).not_to include("X-Amz-Signature")
    end

    it "drops a fragment as well as a query" do
      expect(described_class.redact_url("https://h.invalid/p#access_token=fakevalue"))
        .to eq("https://h.invalid/p?[REDACTED]")
    end

    it "leaves a URL without a query untouched" do
      expect(described_class.redact_url(plain_url)).to eq(plain_url)
    end

    it "returns non-string input unchanged" do
      expect(described_class.redact_url(nil)).to be_nil
      expect(described_class.redact_url(7)).to eq(7)
    end
  end

  describe ".redact_urls" do
    it "maps over an array of paths" do
      expect(described_class.redact_urls([fake_signed_url, plain_url]))
        .to eq(["https://basespace.example.invalid/files/sample_one.fastq.gz?[REDACTED]", plain_url])
    end

    it "handles a single path" do
      expect(described_class.redact_urls(plain_url)).to eq(plain_url)
    end
  end

  describe ".signed_url?" do
    it "is true for a presigned URL" do
      expect(described_class.signed_url?(fake_signed_url)).to be true
    end

    it "is false for a plain URL and for a URL with only benign params" do
      expect(described_class.signed_url?(plain_url)).to be false
      expect(described_class.signed_url?("#{plain_url}?limit=1024")).to be false
    end
  end

  describe ".redact_text" do
    it "strips the signature out of a URL embedded in command stderr" do
      stderr = "curl: (22) The requested URL returned error: 403 Forbidden for #{fake_signed_url}"

      expect(described_class.redact_text(stderr)).not_to include("fakesignaturevalue")
      expect(described_class.redact_text(stderr)).to include("403 Forbidden")
    end

    it "masks a bearer token in free text" do
      redacted = described_class.redact_text("Authorization: Bearer #{fake_token}")

      expect(redacted).not_to include(fake_token)
      expect(redacted).to include("[REDACTED]")
    end

    it "keeps diagnostics that contain no credential intact" do
      expect(described_class.redact_text("curl: (7) Failed to connect")).to eq("curl: (7) Failed to connect")
    end
  end

  describe ".scrub" do
    it "drops values under secret-looking keys, at any nesting depth" do
      scrubbed = described_class.scrub(
        basespace_access_token: fake_token,
        nested: { "Authorization" => "Bearer #{fake_token}", "api_key" => "fakekeyvalue" },
        list: [{ password: "fakepassword" }]
      )

      expect(scrubbed[:basespace_access_token]).to eq("[REDACTED]")
      expect(scrubbed[:nested]["Authorization"]).to eq("[REDACTED]")
      expect(scrubbed[:nested]["api_key"]).to eq("[REDACTED]")
      expect(scrubbed[:list].first[:password]).to eq("[REDACTED]")
      expect(scrubbed.to_s).not_to include(fake_token)
    end

    it "preserves keys, structure and every non-secret value" do
      scrubbed = described_class.scrub(
        sample_id: 42,
        dataset_id: "d1",
        message: "Failed to fetch files for basespace dataset",
        nested: { "count" => 3 }
      )

      expect(scrubbed).to eq(
        sample_id: 42,
        dataset_id: "d1",
        message: "Failed to fetch files for basespace dataset",
        nested: { "count" => 3 }
      )
    end

    it "keeps a fingerprint, which is already one-way" do
      digest = described_class.fingerprint(fake_token)

      expect(described_class.scrub(basespace_token_fingerprint: digest))
        .to eq(basespace_token_fingerprint: digest)
    end

    it "redacts a presigned URL value but leaves a plain URL alone" do
      scrubbed = described_class.scrub(download_path: fake_signed_url, source_path: plain_url)

      expect(scrubbed[:download_path]).not_to include("fakesignaturevalue")
      expect(scrubbed[:source_path]).to eq(plain_url)
    end

    it "bounds recursion instead of looping on a self-referential payload" do
      payload = {}
      payload[:self] = payload

      expect { described_class.scrub(payload) }.not_to raise_error
    end

    it "marks a depth cut as truncated, not as redacted (it is a limit, not a finding)" do
      deep = (1..12).reduce("leaf") { |inner, _| { nested: inner } }

      expect(described_class.scrub(deep).to_s).to include("[TRUNCATED]")
      expect(described_class.scrub(deep).to_s).not_to include("[REDACTED]")
    end
  end

  describe ".redact_bulk_download_callback_token" do
    # Obvious fake. Shaped like a has_secure_token but not a real one.
    let(:fake_callback_token) { "faketokenNotARealCredential0123456789" }

    %w[success error progress].each do |action|
      it "masks the token segment on the #{action} callback path, keeping route and id" do
        path = "/bulk_downloads/123/#{action}/#{fake_callback_token}"

        expect(described_class.redact_bulk_download_callback_token(path))
          .to eq("/bulk_downloads/123/#{action}/[REDACTED]")
      end
    end

    it "masks the token inside a full Started request-log line" do
      line = %(Started POST "/bulk_downloads/123/success/#{fake_callback_token}" for 10.0.0.1 at 2026-08-28 00:00:00 +0000)

      redacted = described_class.redact_bulk_download_callback_token(line)

      expect(redacted).not_to include(fake_callback_token)
      expect(redacted).to include('"/bulk_downloads/123/success/[REDACTED]"')
      # The rest of the line -- method, ip, timestamp -- is untouched.
      expect(redacted).to include("Started POST")
      expect(redacted).to include("for 10.0.0.1 at 2026-08-28 00:00:00 +0000")
    end

    it "does not touch the callback token in a query string (already filtered there)" do
      line = %(Started POST "/bulk_downloads/123/success?extra=1" for 10.0.0.1)

      expect(described_class.redact_bulk_download_callback_token(line))
        .to eq(line)
    end

    it "leaves unrelated request paths untouched" do
      line = %(Started GET "/samples/42/report_v2" for 10.0.0.1)

      expect(described_class.redact_bulk_download_callback_token(line)).to eq(line)
    end

    it "returns non-string input unchanged" do
      expect(described_class.redact_bulk_download_callback_token(nil)).to be_nil
    end
  end
end
