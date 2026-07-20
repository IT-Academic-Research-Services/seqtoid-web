require "rails_helper"
require "webmock/rspec"

# Branch sweep for HttpHelper. The existing http_helper_spec covers get_json/post_json
# happy paths plus the get failure and invalid-JSON arms; this file targets the branches
# it does NOT reach: the non-success arm of post_json and delete, the whole delete method
# (success + failure), and the `unless silence_errors` guard inside get_json. Each example
# flips a single branch. Spec-only.
RSpec.describe HttpHelper, type: :helper do
  let(:url) { "https://www.example.com" }

  describe ".post_json non-success arm" do
    before { stub_request(:post, url).to_return(status: 500, body: "boom") }

    it "logs and raises HttpError carrying the status code" do
      expect(Rails.logger).to receive(:warn).with(/POST request to #{Regexp.escape(url)} failed/)
      expect { HttpHelper.post_json(url, {}) }
        .to raise_error(HttpHelper::HttpError) { |e| expect(e.status_code).to eq(500) }
    end
  end

  describe ".get_json silence_errors guard" do
    before { stub_request(:get, url).to_return(status: 401, body: "nope") }

    it "still raises but suppresses the warn log when silence_errors is true" do
      allow(Rails.logger).to receive(:warn)
      expect { HttpHelper.get_json(url, {}, {}, true) }
        .to raise_error(HttpHelper::HttpError)
      expect(Rails.logger).not_to have_received(:warn).with(/GET request/)
    end

    it "logs the warning when silence_errors is false (default)" do
      expect(Rails.logger).to receive(:warn).with(/GET request to #{Regexp.escape(url)} failed/)
      expect { HttpHelper.get_json(url, {}, {}, false) }
        .to raise_error(HttpHelper::HttpError)
    end
  end

  describe ".delete" do
    it "returns nil on a successful DELETE" do
      stub_request(:delete, url).to_return(status: 204)
      expect(HttpHelper.delete(url, {})).to be_nil
    end

    it "logs and raises HttpError on a failed DELETE" do
      stub_request(:delete, url).to_return(status: 500, body: "boom")
      expect(Rails.logger).to receive(:warn).with(/DELETE request to #{Regexp.escape(url)} failed/)
      expect { HttpHelper.delete(url, {}) }
        .to raise_error(HttpHelper::HttpError) { |e| expect(e.status_code).to eq(500) }
    end
  end
end
