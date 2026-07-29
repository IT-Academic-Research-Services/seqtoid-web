require 'rails_helper'

# Branch coverage for the two HomeController helpers the existing specs always stub out
# rather than run: check_valid_workflow (whose wdl-filename choice differs for
# short-read-mngs) and send_sign_up_to_airtable (whose `|| ""` fallbacks only fire when a
# sign-up field is missing). Named _branch_paths to avoid colliding with the existing
# home_controller_branches_spec companion.
RSpec.describe HomeController, type: :controller do
  create_users

  describe "#check_valid_workflow" do
    def stub_s3_object(content_length)
      response = Aws::S3::Types::GetObjectOutput.new(content_length: content_length)
      client = double("S3Client")
      allow(client).to receive(:get_object).and_return(response)
      allow(AwsClient).to receive(:[]).with(:s3).and_return(client)
      client
    end

    it "looks for host_filter.wdl for short-read-mngs" do
      client = stub_s3_object(120)

      expect(controller.check_valid_workflow(WorkflowRun::WORKFLOW[:short_read_mngs], "8.2.0")).to be(true)
      expect(client).to have_received(:get_object).with(
        bucket: S3_WORKFLOWS_BUCKET,
        key: "#{WorkflowRun::WORKFLOW[:short_read_mngs]}-v8.2.0/host_filter.wdl"
      )
    end

    it "looks for run.wdl for every other workflow" do
      client = stub_s3_object(120)

      expect(controller.check_valid_workflow(WorkflowRun::WORKFLOW[:consensus_genome], "3.4.1")).to be(true)
      expect(client).to have_received(:get_object).with(
        bucket: S3_WORKFLOWS_BUCKET,
        key: "#{WorkflowRun::WORKFLOW[:consensus_genome]}-v3.4.1/run.wdl"
      )
    end

    it "reports an empty object as an invalid workflow" do
      stub_s3_object(0)

      expect(controller.check_valid_workflow(WorkflowRun::WORKFLOW[:amr], "1.0.0")).to be(false)
    end

    it "logs and re-raises when S3 errors" do
      client = double("S3Client")
      allow(client).to receive(:get_object).and_raise(Aws::S3::Errors::NoSuchKey.new(nil, "missing"))
      allow(AwsClient).to receive(:[]).with(:s3).and_return(client)
      allow(Rails.logger).to receive(:error)

      expect { controller.check_valid_workflow(WorkflowRun::WORKFLOW[:amr], "1.0.0") }
        .to raise_error(Aws::S3::Errors::NoSuchKey)
      expect(Rails.logger).to have_received(:error).with(a_string_including("Error fetching S3 object"))
    end
  end

  describe "#send_sign_up_to_airtable" do
    it "forwards every supplied field" do
      allow(MetricUtil).to receive(:post_to_airtable)

      controller.send(:send_sign_up_to_airtable,
                      firstName: "Joe", lastName: "Schmoe", email: "joe@czid.org",
                      institution: "UCSF", usage: "metagenomics")

      expect(MetricUtil).to have_received(:post_to_airtable).with(
        "Landing Page Form",
        { fields: { firstName: "Joe", lastName: "Schmoe", email: "joe@czid.org",
                    institution: "UCSF", usage: "metagenomics", } }.to_json
      )
    end

    it "substitutes empty strings for every missing field" do
      allow(MetricUtil).to receive(:post_to_airtable)

      controller.send(:send_sign_up_to_airtable, {})

      expect(MetricUtil).to have_received(:post_to_airtable).with(
        "Landing Page Form",
        { fields: { firstName: "", lastName: "", email: "", institution: "", usage: "" } }.to_json
      )
    end
  end

  describe "#check_profile_form_completion" do
    it "redirects a user who has not completed the profile form" do
      @joe.update!(profile_form_version: 0)
      sign_in @joe

      get :my_data

      expect(response).to redirect_to(user_profile_form_path)
    end

    it "lets a user who has completed the profile form through" do
      @joe.update!(profile_form_version: 1)
      sign_in @joe

      get :my_data

      expect(response).not_to redirect_to(user_profile_form_path)
    end
  end
end
