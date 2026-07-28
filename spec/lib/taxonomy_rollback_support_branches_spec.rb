# frozen_string_literal: true

require "rails_helper"
require Rails.root.join("lib/taxonomy_rollback_support").to_s

# Branch coverage for the rollback safety net's DB/ES I/O. Everything here is driven through injected
# doubles -- no real MySQL rename, no real OpenSearch call.
RSpec.describe TaxonomyRollbackSupport do
  let(:bg) { TaxonomyBlueGreen }

  describe ".compute_fingerprint" do
    it "reads the checksum when CHECKSUM TABLE returns a row" do
      conn = instance_double(ActiveRecord::ConnectionAdapters::AbstractAdapter)
      allow(conn).to receive(:select_all).with(bg.checksum_sql(bg::LIVE_TABLE))
                                         .and_return([{ "Table" => "taxon_lineages", "Checksum" => 42 }])
      allow(conn).to receive(:select_one).with(bg.stats_sql(bg::LIVE_TABLE))
                                         .and_return("row_count" => 7, "distinct_taxid" => 5,
                                                     "min_version_start" => 1, "max_version_end" => 3)

      fp = described_class.compute_fingerprint(conn)

      expect(fp["table"]).to eq("taxon_lineages")
      expect(fp["checksum"]).to eq(42)
      expect(fp["row_count"]).to eq(7)
      expect(fp["distinct_taxid"]).to eq(5)
    end

    it "yields a nil checksum when CHECKSUM TABLE returns no rows (safe-nav nil receiver)" do
      conn = instance_double(ActiveRecord::ConnectionAdapters::AbstractAdapter)
      allow(conn).to receive(:select_all).with(bg.checksum_sql("taxon_lineages_bak_20260101T0000Z"))
                                         .and_return([])
      allow(conn).to receive(:select_one).and_return(nil)

      fp = described_class.compute_fingerprint(conn, "taxon_lineages_bak_20260101T0000Z")

      expect(fp["table"]).to eq("taxon_lineages_bak_20260101T0000Z")
      expect(fp["checksum"]).to be_nil
      # stats_sql returned nil -> the `|| {}` fallback leaves every stat nil rather than raising.
      expect(fp["row_count"]).to be_nil
      expect(fp["max_version_end"]).to be_nil
    end
  end

  describe ".list_backups / .latest_backup" do
    let(:conn) { instance_double(ActiveRecord::ConnectionAdapters::AbstractAdapter) }

    before do
      allow(conn).to receive(:select_rows).with(bg.show_backups_sql).and_return(
        [["taxon_lineages_bak_20260101T0000Z"],
         ["taxon_lineages_bak_20260709T1200Z"],
         ["not_a_backup_table"],
         ["taxon_lineages_bak_20260315T0900Z"],]
      )
    end

    it "keeps only recognized backups, newest-first" do
      expect(described_class.list_backups(conn)).to eq(
        ["taxon_lineages_bak_20260709T1200Z",
         "taxon_lineages_bak_20260315T0900Z",
         "taxon_lineages_bak_20260101T0000Z",]
      )
    end

    it "returns the newest backup as the default rollback target" do
      expect(described_class.latest_backup(conn)).to eq("taxon_lineages_bak_20260709T1200Z")
    end

    it "returns nil when nothing preserved matches the backup naming" do
      allow(conn).to receive(:select_rows).and_return([["some_other_table"]])
      expect(described_class.list_backups(conn)).to eq([])
      expect(described_class.latest_backup(conn)).to be_nil
    end
  end

  describe ".es_alias_state" do
    let(:indices) { double("indices") }
    let(:client) { double("es_client", indices: indices) }

    before do
      # ELASTICSEARCH_ON is off in the test env, so TaxonLineage does not include
      # Elasticsearch::Model and the verifying double would reject __elasticsearch__.
      without_partial_double_verification do
        allow(TaxonLineage).to receive(:__elasticsearch__).and_return(double(client: client))
      end
    end

    it "reports the concrete index and doc count when the alias exists" do
      allow(indices).to receive(:exists_alias).with(name: bg::ALIAS_NAME).and_return(true)
      allow(indices).to receive(:get_alias).with(name: bg::ALIAS_NAME)
                                           .and_return("taxon_lineages_v2026_07_09" => {})
      allow(client).to receive(:count).with(index: bg::ALIAS_NAME).and_return("count" => 1234)

      expect(described_class.es_alias_state).to eq(
        "alias_target" => "taxon_lineages_v2026_07_09", "doc_count" => 1234
      )
    end

    it "reports an empty state when the alias does not exist (no get_alias/count calls)" do
      allow(indices).to receive(:exists_alias).with(name: bg::ALIAS_NAME).and_return(false)
      expect(indices).not_to receive(:get_alias)
      expect(client).not_to receive(:count)

      expect(described_class.es_alias_state).to eq("alias_target" => nil, "doc_count" => nil)
    end

    it "degrades to an error marker instead of raising when ES is unreachable" do
      allow(indices).to receive(:exists_alias).and_raise(Errno::ECONNREFUSED)

      state = described_class.es_alias_state
      expect(state["alias_target"]).to eq("(error: Errno::ECONNREFUSED)")
      expect(state["doc_count"]).to be_nil
    end
  end

  describe ".restore_es_alias" do
    let(:indices) { double("indices") }
    let(:client) { double("es_client", indices: indices) }
    let(:proxy) { double("es_proxy", client: client) }

    before do
      without_partial_double_verification do
        allow(TaxonLineage).to receive(:__elasticsearch__).and_return(proxy)
      end
      allow(indices).to receive(:refresh)
      allow(indices).to receive(:update_aliases)
    end

    it "takes the fast path when a retained index's doc count matches the restored rows" do
      allow(indices).to receive(:exists_alias).with(name: bg::ALIAS_NAME).and_return(true)
      allow(indices).to receive(:get_alias).with(name: bg::ALIAS_NAME)
                                           .and_return("taxon_lineages_v2026_07_09" => {})
      allow(indices).to receive(:get).with(index: "taxon_lineages_v*")
                                     .and_return("taxon_lineages_v2026_07_09" => {},
                                                 "taxon_lineages_v2026_01_01" => {})
      allow(client).to receive(:count).with(index: "taxon_lineages_v2026_01_01").and_return("count" => 500)

      expect(proxy).not_to receive(:create_index!)
      expect(indices).to receive(:update_aliases).with(
        body: { actions: [
          { add: { index: "taxon_lineages_v2026_01_01", alias: bg::ALIAS_NAME } },
          { remove: { index: "taxon_lineages_v2026_07_09", alias: bg::ALIAS_NAME } },
        ] }
      )

      desc = described_class.restore_es_alias(restored_row_count: 500)
      expect(desc).to include("fast path")
      expect(desc).to include("taxon_lineages_v2026_01_01")
    end

    it "reindexes (safe path) when no retained index matches, and adds only when there is no prior alias" do
      allow(indices).to receive(:exists_alias).with(name: bg::ALIAS_NAME).and_return(false)
      allow(indices).to receive(:get).with(index: "taxon_lineages_v*")
                                     .and_return("taxon_lineages_v2026_01_01" => {})
      allow(client).to receive(:count).with(index: "taxon_lineages_v2026_01_01").and_return("count" => 1)
      allow(proxy).to receive(:create_index!)
      allow(proxy).to receive(:import)

      expect(proxy).to receive(:create_index!).with(hash_including(:index))
      expect(proxy).to receive(:import).with(hash_including(refresh: true))
      captured = nil
      allow(indices).to receive(:update_aliases) { |args| captured = args }

      desc = described_class.restore_es_alias(restored_row_count: 999)

      expect(desc).to include("safe path")
      expect(desc).to include("taxon_lineages_rollback_")
      # No previous alias target -> no remove action, only the add.
      expect(captured[:body][:actions].length).to eq(1)
      expect(captured[:body][:actions].first).to have_key(:add)
    end

    it "treats a candidate index that errors on count as a non-match and falls through to reindex" do
      allow(indices).to receive(:exists_alias).with(name: bg::ALIAS_NAME).and_return(false)
      allow(indices).to receive(:get).with(index: "taxon_lineages_v*")
                                     .and_return("taxon_lineages_v2026_01_01" => {})
      allow(client).to receive(:count).and_raise(StandardError, "index closed")
      allow(proxy).to receive(:create_index!)
      allow(proxy).to receive(:import)

      expect(described_class.restore_es_alias(restored_row_count: 10)).to include("safe path")
    end
  end

  describe ".move_alias" do
    let(:indices) { double("indices") }
    let(:client) { double("es_client", indices: indices) }

    it "adds and removes when moving away from a different index" do
      expect(indices).to receive(:update_aliases).with(
        body: { actions: [
          { add: { index: "b", alias: TaxonomyBlueGreen::ALIAS_NAME } },
          { remove: { index: "a", alias: TaxonomyBlueGreen::ALIAS_NAME } },
        ] }
      )
      described_class.move_alias(client, to: "b", from: "a")
    end

    it "only adds when there is no prior index" do
      expect(indices).to receive(:update_aliases).with(
        body: { actions: [{ add: { index: "b", alias: TaxonomyBlueGreen::ALIAS_NAME } }] }
      )
      described_class.move_alias(client, to: "b", from: nil)
    end

    it "only adds when the prior index is the same index (no self-remove)" do
      expect(indices).to receive(:update_aliases).with(
        body: { actions: [{ add: { index: "b", alias: TaxonomyBlueGreen::ALIAS_NAME } }] }
      )
      described_class.move_alias(client, to: "b", from: "b")
    end
  end

  describe ".fmt" do
    it "renders a one-line summary of a fingerprint" do
      line = described_class.fmt(
        "row_count" => 12, "distinct_taxid" => 9,
        "min_version_start" => 1, "max_version_end" => 4, "checksum" => 777
      )
      expect(line).to eq("rows=12 distinct_taxid=9 versions=[1..4] checksum=777")
    end

    it "renders a placeholder for a nil fingerprint" do
      expect(described_class.fmt(nil)).to eq("(nil)")
    end
  end
end
