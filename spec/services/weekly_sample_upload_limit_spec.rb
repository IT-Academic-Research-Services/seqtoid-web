require "rails_helper"

RSpec.describe WeeklySampleUploadLimit, type: :service do
  create_users

  def set_limit(scope, value)
    AppConfigHelper.set_app_config(described_class::LIMIT_KEYS.fetch(scope), value)
  end

  def used(user, channel)
    described_class.usage(user)[channel]
  end

  def reserve(user, counts)
    described_class.reserve(user: user, counts: counts)
  end

  describe ".week_start / .resets_at" do
    it "starts the week on Sunday 00:00 Pacific" do
      saturday_night = Time.zone.parse("2026-10-31 23:30:00 -07:00")
      sunday_morning = Time.zone.parse("2026-11-01 00:30:00 -07:00")

      expect(described_class.week_start(saturday_night)).to eq(Date.new(2026, 10, 25))
      expect(described_class.week_start(sunday_morning)).to eq(Date.new(2026, 11, 1))
    end

    it "uses Pacific, not UTC, for the boundary" do
      # Sunday 03:00 UTC is still Saturday evening in Pacific.
      expect(described_class.week_start(Time.utc(2026, 11, 1, 3, 0))).to eq(Date.new(2026, 10, 25))
    end

    it "resets at the next Sunday midnight Pacific across a DST change" do
      expect(described_class.resets_at(Date.new(2026, 10, 25)).iso8601).to eq("2026-11-01T00:00:00-07:00")
      expect(described_class.resets_at(Date.new(2026, 11, 1)).iso8601).to eq("2026-11-08T00:00:00-08:00")
    end
  end

  describe ".counts_for" do
    it "counts every sample of a CLI request as cli" do
      expect(described_class.counts_for([["local"], ["s3"]], cli: true)).to eq("cli" => 2)
    end

    it "splits a browser request into s3, basespace and web by the samples' file sources" do
      sources = [["s3", "s3"], ["basespace"], ["local", "local"], ["s3", "local"], []]
      expect(described_class.counts_for(sources, cli: false)).to eq("s3" => 1, "basespace" => 1, "web" => 3)
    end
  end

  describe ".limits_for" do
    it "has no limits when nothing is configured (ships off)" do
      expect(described_class.limits_for(@joe).values).to all(be_nil)
    end

    it "ignores blank, zero and non-numeric settings" do
      ["", "0", "-1", "lots"].each do |v|
        set_limit("web", v)
        expect(described_class.limits_for(@joe)["web"]).to be_nil, v
      end
    end

    it "exempts admins" do
      set_limit("web", "200")
      expect(described_class.limits_for(@admin).values).to all(be_nil)
    end

    it "applies an active override per scope and keeps the default elsewhere" do
      set_limit("web", "200")
      set_limit("cli", "1000")
      create(:sample_upload_limit_override, user: @joe, cli_weekly_limit: 5000)

      expect(described_class.limits_for(@joe)).to include("cli" => 5000, "web" => 200)
    end

    it "lifts every limit for an unlimited override and ignores an expired one" do
      set_limit("web", "200")
      override = create(:sample_upload_limit_override, user: @joe, unlimited: true)
      expect(described_class.limits_for(@joe).values).to all(be_nil)

      override.update!(expires_at: 1.minute.ago)
      expect(described_class.limits_for(@joe)["web"]).to eq(200)
    end
  end

  describe ".reserve" do
    it "allows and counts an upload under the limit" do
      set_limit("web", "200")

      expect(reserve(@joe, "web" => 150)).to be_allowed
      expect(used(@joe, "web")).to eq(150)
    end

    it "rejects the whole upload when it would cross the limit, counting nothing" do
      set_limit("web", "200")
      reserve(@joe, "web" => 150)

      reservation = reserve(@joe, "web" => 51)

      expect(reservation).not_to be_allowed
      expect(reservation.scope).to eq("web")
      expect(reservation.used).to eq(150)
      expect(reservation.requested).to eq(51)
      expect(used(@joe, "web")).to eq(150)
      expect(described_class.rejection_message(reservation)).to include("200 samples per week through the web uploader", "50 left")
    end

    it "allows exactly up to the limit" do
      set_limit("cli", "1000")
      expect(reserve(@joe, "cli" => 1000)).to be_allowed
      expect(reserve(@joe, "cli" => 1)).not_to be_allowed
    end

    it "keeps channels separate" do
      set_limit("web", "200")
      set_limit("cli", "1000")
      reserve(@joe, "web" => 200)

      expect(reserve(@joe, "cli" => 1000)).to be_allowed
    end

    it "pools s3 and basespace with the cli allowance when they have no limit of their own" do
      set_limit("cli", "1000")
      set_limit("web", "200")
      reserve(@joe, "cli" => 600)
      reserve(@joe, "s3" => 300)

      reservation = reserve(@joe, "basespace" => 101)

      expect(reservation).not_to be_allowed
      expect(reservation.scope).to eq("cli")
      expect(reservation.used).to eq(900)
      expect(described_class.rejection_message(reservation))
        .to include("1000 samples per week through the SeqToID CLI, BaseSpace import, and S3 import combined", "100 left")
      expect(reserve(@joe, "web" => 200)).to be_allowed
    end

    it "gives s3 its own allowance when its limit is set" do
      set_limit("cli", "1000")
      set_limit("s3", "500")
      reserve(@joe, "cli" => 1000)

      expect(reserve(@joe, "s3" => 500)).to be_allowed
      expect(reserve(@joe, "s3" => 1).scope).to eq("s3")
    end

    context "with the decided limits: web 200, cli + s3 + basespace 1000, 1200 in total" do
      before do
        set_limit("web", "200")
        set_limit("cli", "1000")
        set_limit("total", "1200")
      end

      it "allows the full 200 web plus 1000 across cli, s3 and basespace in one week" do
        expect(reserve(@joe, "web" => 200)).to be_allowed
        expect(reserve(@joe, "cli" => 500)).to be_allowed
        expect(reserve(@joe, "s3" => 300)).to be_allowed
        expect(reserve(@joe, "basespace" => 200)).to be_allowed
        expect(described_class.summary(@joe)[:used]["total"]).to eq(1200)
      end

      it "stops a 201st web sample and a 1001st cli/s3/basespace sample" do
        reserve(@joe, "web" => 200)
        reserve(@joe, "s3" => 1000)

        expect(reserve(@joe, "web" => 1).scope).to eq("web")
        expect(reserve(@joe, "cli" => 1).scope).to eq("cli")
      end
    end

    it "enforces the total on top of the channel limits" do
      set_limit("web", "200")
      set_limit("cli", "1000")
      set_limit("total", "1000")
      reserve(@joe, "cli" => 900)

      reservation = reserve(@joe, "web" => 150)

      expect(reservation).not_to be_allowed
      expect(reservation.scope).to eq("total")
      expect(reservation.used).to eq(900)
    end

    it "lets an admin upload past every limit without counting" do
      set_limit("web", "1")
      expect(reserve(@admin, "web" => 500)).to be_allowed
      expect(used(@admin, "web")).to eq(0)
    end

    it "starts each week from zero" do
      set_limit("web", "200")
      described_class.reserve(user: @joe, counts: { "web" => 200 }, now: Time.zone.parse("2026-10-31 23:00:00 -07:00"))

      expect(described_class.reserve(user: @joe, counts: { "web" => 200 }, now: Time.zone.parse("2026-11-01 01:00:00 -07:00"))).to be_allowed
    end
  end

  describe ".release" do
    it "gives back samples the upload did not create, per channel" do
      set_limit("web", "200")
      reservation = reserve(@joe, "web" => 10, "s3" => 5)

      described_class.release(reservation, "web" => 7, "s3" => 5)

      expect(used(@joe, "web")).to eq(7)
      expect(used(@joe, "s3")).to eq(5)
    end

    it "is a no-op for an upload that was not limited" do
      reservation = reserve(@joe, "web" => 10)
      expect { described_class.release(reservation, {}) }.not_to change(WeeklySampleUploadUsage, :count)
    end
  end

  describe ".summary" do
    it "reports what is left per channel after both the channel and total limits" do
      set_limit("web", "200")
      set_limit("cli", "1000")
      set_limit("total", "1100")
      reserve(@joe, "cli" => 850)
      reserve(@joe, "s3" => 20)
      reserve(@joe, "web" => 150)

      summary = described_class.summary(@joe)

      # cli pool: 1000 - 870 = 130; total: 1100 - 1020 = 80 caps it. web: 200 - 150 = 50.
      expect(summary[:remaining]).to include("cli" => 80, "s3" => 80, "basespace" => 80, "web" => 50)
      expect(summary[:used]).to include("cli" => 850, "s3" => 20, "web" => 150, "total" => 1020)
      expect(summary[:unlimited]).to be(false)
    end
  end
end
