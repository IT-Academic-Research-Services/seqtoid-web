require "rails_helper"

# Coverage for the pure parsing / filtering / formatting helpers in
# BulkDownloadsHelper not exercised by bulk_download_helper_spec.rb (which covers
# combined-taxon CSV, biom, CG overview, and metadata CSV generation).
RSpec.describe BulkDownloadsHelper, type: :helper do
  describe ".filter_zscore" do
    it "passes a value that satisfies a >= filter" do
      filters = [{ operator: ">=", value: "1.0" }]
      expect(BulkDownloadsHelper.filter_zscore(filters, 2.0)).to be(true)
      expect(BulkDownloadsHelper.filter_zscore(filters, 0.5)).to be(false)
    end

    it "passes a value that satisfies a <= filter" do
      filters = [{ operator: "<=", value: "5.0" }]
      expect(BulkDownloadsHelper.filter_zscore(filters, 3.0)).to be(true)
      expect(BulkDownloadsHelper.filter_zscore(filters, 6.0)).to be(false)
    end

    it "requires all filters to pass" do
      filters = [{ operator: ">=", value: "1.0" }, { operator: "<=", value: "5.0" }]
      expect(BulkDownloadsHelper.filter_zscore(filters, 3.0)).to be(true)
      expect(BulkDownloadsHelper.filter_zscore(filters, 10.0)).to be(false)
    end

    it "raises on an unrecognized operator" do
      filters = [{ operator: "!!", value: "1.0" }]
      expect { BulkDownloadsHelper.filter_zscore(filters, 3.0) }
        .to raise_error(RuntimeError, BulkDownloadsHelper::INVALID_OPERATOR_ERROR)
    end
  end

  describe ".parse_metric_string" do
    it "parses an underscore-delimited metric" do
      expect(BulkDownloadsHelper.parse_metric_string("NT_rpm")).to eq(["NT", "rpm"])
    end

    it "parses a dot-delimited metric" do
      expect(BulkDownloadsHelper.parse_metric_string("NR.zscore")).to eq(["NR", "z_score"])
    end

    it "maps front-end metric names to db column names" do
      expect(BulkDownloadsHelper.parse_metric_string("NT_r")).to eq(["NT", "count"])
      expect(BulkDownloadsHelper.parse_metric_string("NT_percentidentity")).to eq(["NT", "percent_identity"])
      expect(BulkDownloadsHelper.parse_metric_string("NR_logevalue")).to eq(["NR", "e_value"])
    end
  end

  describe ".parse_filters" do
    it "parses each filter into a normalized hash with a float value" do
      filters = [
        { "metric" => "NT_rpm", "value" => "1.5", "operator" => ">=" },
        { "metric" => "NR.zscore", "value" => "2", "operator" => "<=" },
      ]
      result = BulkDownloadsHelper.parse_filters(filters)
      expect(result).to eq([
                             { metric: "rpm", value: 1.5, operator: ">=", count_type: "NT" },
                             { metric: "z_score", value: 2.0, operator: "<=", count_type: "NR" },
                           ])
    end
  end

  describe ".filter_by_count_type" do
    it "returns the metrics unchanged when count_type is not NT/NR" do
      metrics = double("relation")
      expect(BulkDownloadsHelper.filter_by_count_type("OTHER", metrics)).to eq(metrics)
    end

    it "scopes to the count_type for NT" do
      metrics = double("relation")
      scoped = double("scoped")
      expect(metrics).to receive(:where).with(count_type: "NT").and_return(scoped)
      expect(BulkDownloadsHelper.filter_by_count_type("NT", metrics)).to eq(scoped)
    end
  end

  describe ".filter_by_category" do
    it "returns the metrics unchanged when categories are blank" do
      metrics = double("relation")
      expect(BulkDownloadsHelper.filter_by_category([], metrics)).to eq(metrics)
      expect(BulkDownloadsHelper.filter_by_category(nil, metrics)).to eq(metrics)
    end
  end

  describe ".output_tsv_row" do
    it "does nothing when prev_taxon_count is nil" do
      tsv = []
      taxonomy_tsv = []
      BulkDownloadsHelper.output_tsv_row(tsv, taxonomy_tsv, [1, 2], nil)
      expect(tsv).to be_empty
      expect(taxonomy_tsv).to be_empty
    end

    it "writes the metric row and the taxonomy row keyed by the joined taxon id" do
      tsv = []
      taxonomy_tsv = []
      prev_taxon_count = BulkDownloadsHelper::TAXONOMY_LIST.each_with_index.to_h { |name, i| [name, "L#{i}"] }
      BulkDownloadsHelper.output_tsv_row(tsv, taxonomy_tsv, [10, 20], prev_taxon_count)

      taxon_uniq_id = (0...BulkDownloadsHelper::TAXONOMY_LIST.length).map { |i| "L#{i}" }.join(";")
      # sample metrics get the taxon id unshifted onto the front.
      expect(tsv.first).to eq([taxon_uniq_id, 10, 20])
      # taxonomy row drops the first (superkingdom) level then unshifts the uniq id.
      expect(taxonomy_tsv.first.first).to eq(taxon_uniq_id)
      expect(taxonomy_tsv.first.length).to eq(BulkDownloadsHelper::TAXONOMY_LIST.length)
    end
  end

  describe ".cg_overview_headers" do
    it "starts with the fixed reference columns" do
      headers = BulkDownloadsHelper.cg_overview_headers
      expect(headers[0, 3]).to eq(["Sample Name", "Reference Accession", "Reference Accession ID"])
      expect(headers.length).to be > 3
    end
  end

  describe ".generate_metadata_arr" do
    it "returns a header row plus one row per sample" do
      sample = create(:sample, metadata_fields: { "sample_type" => "Serum" })
      arr = BulkDownloadsHelper.generate_metadata_arr(Sample.where(id: sample.id))
      expect(arr.first.first).to eq("sample_name")
      expect(arr.first).to include("sample_type")
      expect(arr[1].first).to eq(sample.name)
      expect(arr[1]).to include("Serum")
    end

    # Host organism is a fixed column, not a metadata field, so it has to be pinned by position.
    it "emits host organism as the second column, before the metadata fields" do
      sample = create(:sample, host_genome_name: "Mosquito", metadata_fields: { "sample_type" => "Serum" })
      arr = BulkDownloadsHelper.generate_metadata_arr(Sample.where(id: sample.id))
      expect(arr.first[0, 2]).to eq(["sample_name", "host_organism"])
      expect(arr[1][0, 2]).to eq([sample.name, "Mosquito"])
    end
  end
end
