require 'rails_helper'

# How a preview sandbox learns its pipelines moved: poll (no shoryuken, monitors poll SFN) or sqs
# (its own filtered queue, its own shoryuken). The two halves -- sandbox:provision writing
# SANDBOX_NOTIFICATIONS_MODE into the sandbox config, and sandbox:seed_once setting
# enable_sfn_notifications from it -- must agree, or the UI silently never advances: flag 1 with no
# consumer means nobody polls; flag 0 with a consumer means messages are ignored.
describe 'sandbox notification mode' do
  before(:all) { Rails.application.load_tasks unless Rake::Task.task_defined?('sandbox:seed_once') }

  describe 'sandbox_notifications_mode' do
    it 'defaults to poll, so sandboxes provisioned before sqs mode keep polling' do
      ClimateControl.modify(SANDBOX_NOTIFICATIONS_MODE: nil) { expect(send(:sandbox_notifications_mode)).to eq('poll') }
      ClimateControl.modify(SANDBOX_NOTIFICATIONS_MODE: '') { expect(send(:sandbox_notifications_mode)).to eq('poll') }
    end

    it 'accepts sqs' do
      ClimateControl.modify(SANDBOX_NOTIFICATIONS_MODE: 'sqs') { expect(send(:sandbox_notifications_mode)).to eq('sqs') }
    end

    it 'raises on anything else rather than guessing' do
      ClimateControl.modify(SANDBOX_NOTIFICATIONS_MODE: 'SQS ') do
        expect { send(:sandbox_notifications_mode) }.to raise_error(/must be 'poll' or 'sqs'/)
      end
    end
  end

  describe 'sandbox_execution_name_prefix' do
    it 'defaults to idseq-pr-<N>, the prefix the ApplicationSet gives the app' do
      ClimateControl.modify(SANDBOX_SFN_EXECUTION_NAME_PREFIX: nil) do
        expect(send(:sandbox_execution_name_prefix, '77')).to eq('idseq-pr-77')
      end
    end

    it 'accepts an override that still ends in pr-<N>' do
      ClimateControl.modify(SANDBOX_SFN_EXECUTION_NAME_PREFIX: 'czid-pr-77') do
        expect(send(:sandbox_execution_name_prefix, '77')).to eq('czid-pr-77')
      end
    end

    # A prefix that is not this PR's would filter in dev's (or another sandbox's) events, and this
    # sandbox's shoryuken would then act on and delete messages that are not its own.
    it "refuses a prefix that could match dev's or another PR's executions" do
      %w[idseq-development idseq-pr-7 idseq-pr-777 idseq-pr].each do |bad|
        ClimateControl.modify(SANDBOX_SFN_EXECUTION_NAME_PREFIX: bad) do
          expect { send(:sandbox_execution_name_prefix, '77') }.to raise_error(/must end in 'pr-77'/)
        end
      end
    end
  end

  describe 'sandbox:seed_once enable_sfn_notifications' do
    let(:task) { Rake::Task['sandbox:seed_once'] }

    before do
      # A non-empty app_configs table, so seed_once takes the "already seeded" branch and only the
      # flag logic under test runs. seed:migrate is real I/O against the seed catalog; stub it out.
      AppConfig.create!(key: 'seed_once_spec_marker', value: 'x')
      allow(Rake::Task['seed:migrate']).to receive(:invoke)
      task.reenable
    end

    def flag
      AppConfig.find_by(key: AppConfig::ENABLE_SFN_NOTIFICATIONS)&.value
    end

    it 'sets 1 in sqs mode: the sandbox has its own queue and shoryuken' do
      AppConfig.create!(key: AppConfig::ENABLE_SFN_NOTIFICATIONS, value: '0')
      ClimateControl.modify(SANDBOX_NOTIFICATIONS_MODE: 'sqs') { expect { task.invoke }.to output(/-> "1" for sqs mode/).to_stdout }
      expect(flag).to eq('1')
    end

    it 'forces 0 in poll mode (the default), overriding the 1 that db:seed writes' do
      AppConfig.create!(key: AppConfig::ENABLE_SFN_NOTIFICATIONS, value: '1')
      ClimateControl.modify(SANDBOX_NOTIFICATIONS_MODE: nil) { expect { task.invoke }.to output(/-> "0" for poll mode/).to_stdout }
      expect(flag).to eq('0')
    end

    it 'leaves a correct flag alone' do
      AppConfig.create!(key: AppConfig::ENABLE_SFN_NOTIFICATIONS, value: '1')
      ClimateControl.modify(SANDBOX_NOTIFICATIONS_MODE: 'sqs') { expect { task.invoke }.to output(/already 1 \(sqs mode\)/).to_stdout }
      expect(flag).to eq('1')
    end

    it 'creates the flag when the row is missing' do
      ClimateControl.modify(SANDBOX_NOTIFICATIONS_MODE: 'sqs') { expect { task.invoke }.to output.to_stdout }
      expect(flag).to eq('1')
    end
  end
end
