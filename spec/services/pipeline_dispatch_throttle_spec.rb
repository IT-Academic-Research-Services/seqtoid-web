require "rails_helper"

RSpec.describe PipelineDispatchThrottle, type: :service do
  create_users

  let(:project) { create(:project, users: [@joe, @admin]) }

  def running_run(user, **attrs)
    sample = create(:sample, project: project, user: user)
    create(:pipeline_run, sample: sample, finalized: 0, sfn_execution_arn: "arn:sfn:#{SecureRandom.hex(4)}", **attrs)
  end

  def new_run(user)
    create(:pipeline_run, sample: create(:sample, project: project, user: user), finalized: 0, sfn_execution_arn: nil)
  end

  def configure_cap(value)
    AppConfigHelper.set_app_config(AppConfig::MAX_ACTIVE_PIPELINE_RUNS_PER_USER, value)
  end

  describe ".cap" do
    it "is nil when unset, blank, zero or not an integer (no cap)" do
      expect(described_class.cap).to be_nil
      ["", "0", "-5", "lots"].each do |v|
        configure_cap(v)
        expect(described_class.cap).to be_nil, v
      end
    end

    it "is the configured positive integer" do
      configure_cap(" 200 ")
      expect(described_class.cap).to eq(200)
    end
  end

  describe ".active_count" do
    it "counts only the user's dispatched, unfinished, current runs" do
      running_run(@joe)
      running_run(@joe)
      running_run(@joe, finalized: 1)            # finished
      running_run(@joe, deprecated: true)        # superseded
      new_run(@joe)                              # not dispatched yet
      running_run(@admin)                        # someone else

      expect(described_class.active_count(@joe.id)).to eq(2)
    end
  end

  describe "consensus-genome / AMR workflow runs" do
    def running_wr(user, workflow: WorkflowRun::WORKFLOW[:consensus_genome], **attrs)
      create(:workflow_run, sample: create(:sample, project: project, user: user), user: user,
                            workflow: workflow, status: WorkflowRun::STATUS[:running], **attrs)
    end

    it "counts the user's RUNNING CG and AMR runs together with their mNGS runs" do
      running_run(@joe)
      running_wr(@joe)
      running_wr(@joe, workflow: WorkflowRun::WORKFLOW[:amr])
      running_wr(@joe, status: WorkflowRun::STATUS[:succeeded])                     # finished
      running_wr(@joe, deprecated: true)                                            # superseded
      running_wr(@joe, workflow: WorkflowRun::WORKFLOW[:benchmark])                 # not capped
      expect(described_class.active_count(@joe.id)).to eq(3)
    end

    it "attributes a workflow run to the user who started it" do
      wr = create(:workflow_run, sample: create(:sample, project: project, user: @admin), user: @joe)
      expect(described_class.user_id_for(wr)).to eq(@joe.id)
    end

    it "defers a new CG run once the user is at the cap" do
      configure_cap("1")
      running_wr(@joe)
      wr = create(:workflow_run, sample: create(:sample, project: project, user: @joe), user: @joe)
      expect(described_class.defer?(wr)).to be(true)
    end
  end

  describe ".defer?" do
    it "never defers when no cap is configured" do
      3.times { running_run(@joe) }
      expect(described_class.defer?(new_run(@joe))).to be(false)
    end

    it "defers once the user is at the cap, and not below it" do
      configure_cap("2")
      running_run(@joe)
      expect(described_class.defer?(new_run(@joe))).to be(false)
      running_run(@joe)
      expect(described_class.defer?(new_run(@joe))).to be(true)
    end

    it "exempts admins" do
      configure_cap("1")
      2.times { running_run(@admin) }
      expect(described_class.defer?(new_run(@admin))).to be(false)
    end

    it "is per user: one user at the cap does not hold anyone else back" do
      configure_cap("1")
      running_run(@joe)
      other = create(:user)
      expect(described_class.defer?(new_run(other))).to be(false)
    end
  end
end
