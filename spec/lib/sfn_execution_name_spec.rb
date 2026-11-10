require "rails_helper"

RSpec.describe SfnExecutionName do
  describe ".prefix" do
    before { allow(ENV).to receive(:[]).and_call_original }

    def with_prefix(value)
      allow(ENV).to receive(:[]).with(described_class::ENV_KEY).and_return(value)
    end

    it "returns the caller's default when no prefix is configured" do
      with_prefix(nil)
      expect(described_class.prefix("idseq-development")).to eq("idseq-development")
    end

    it "treats a blank setting as unset" do
      with_prefix("  ")
      expect(described_class.prefix("czid-development")).to eq("czid-development")
    end

    it "returns the configured prefix instead of the default" do
      with_prefix("idseq-pr-753")
      expect(described_class.prefix("idseq-development")).to eq("idseq-pr-753")
    end

    it "strips surrounding whitespace from the configured prefix" do
      with_prefix(" idseq-pr-753\n")
      expect(described_class.prefix("idseq-development")).to eq("idseq-pr-753")
    end

    it "rejects characters Step Functions does not allow in an execution name" do
      with_prefix("idseq pr/753")
      expect { described_class.prefix("idseq-development") }
        .to raise_error(ArgumentError, %r{SFN_EXECUTION_NAME_PREFIX="idseq pr/753"})
    end

    it "rejects a prefix long enough to push names past the 80-character limit" do
      with_prefix("a" * 41)
      expect { described_class.prefix("idseq-development") }.to raise_error(ArgumentError)
    end
  end
end
