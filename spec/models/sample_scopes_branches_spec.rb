require 'rails_helper'

# Coverage Wave (branch): sample_spec.rb never drives the nil/admin/member arms of
# the authorization scopes. This spec drives the nil and admin arms (the member
# arm executes a project_ids pluck that needs real data and is intentionally left
# to the fuller integration coverage) using in-memory relations compared via
# #to_sql / identity (no query executes, no DB writes). Each test fails if its
# branch is inverted or removed:
#   - .viewable: user.nil? -> none, vs admin -> all
#   - .editable: user.nil? -> nil, vs admin -> all
RSpec.describe Sample, type: :model do
  describe ".viewable" do
    it "returns an empty scope when there is no user (nil guard arm)" do
      expect(Sample.viewable(nil).to_sql).to eq(Sample.none.to_sql)
    end

    it "returns the unrestricted scope for an admin (elsif arm)" do
      expect(Sample.viewable(double("admin", admin?: true)).to_sql).to eq(Sample.all.to_sql)
    end
  end

  describe ".editable" do
    it "returns nil when there is no user (nil guard arm)" do
      expect(Sample.editable(nil)).to be_nil
    end

    it "returns the unrestricted scope for an admin (elsif arm)" do
      expect(Sample.editable(double("admin", admin?: true)).to_sql).to eq(Sample.all.to_sql)
    end
  end
end
