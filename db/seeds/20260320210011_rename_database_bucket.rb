class RenameDatabaseBucket < SeedMigration::Migration
  def up
    AlignmentConfig.update_all("diamond_db_path = replace(diamond_db_path,'czid-public-references','seqtoid-public-references')")
    AlignmentConfig.update_all("minimap2_long_db_path = replace(minimap2_long_db_path,'czid-public-references','seqtoid-public-references')")
    AlignmentConfig.update_all("minimap2_short_db_path = replace(minimap2_short_db_path,'czid-public-references','seqtoid-public-references')")
    AlignmentConfig.update_all("s3_accession2taxid_path = replace(s3_accession2taxid_path,'czid-public-references','seqtoid-public-references')")
    AlignmentConfig.update_all("s3_deuterostome_db_path = replace(s3_deuterostome_db_path,'czid-public-references','seqtoid-public-references')")
    AlignmentConfig.update_all("s3_lineage_path = replace(s3_lineage_path,'czid-public-references','seqtoid-public-references')")
    AlignmentConfig.update_all("s3_nr_db_path = replace(s3_nr_db_path,'czid-public-references','seqtoid-public-references')")
    AlignmentConfig.update_all("s3_nr_loc_db_path = replace(s3_nr_loc_db_path,'czid-public-references','seqtoid-public-references')")
    AlignmentConfig.update_all("s3_nt_db_path = replace(s3_nt_db_path,'czid-public-references','seqtoid-public-references')")
    AlignmentConfig.update_all("s3_nt_info_db_path = replace(s3_nt_info_db_path,'czid-public-references','seqtoid-public-references')")
    AlignmentConfig.update_all("s3_nt_loc_db_path = replace(s3_nt_loc_db_path,'czid-public-references','seqtoid-public-references')")
    AlignmentConfig.update_all("s3_taxon_blacklist_path = replace(s3_taxon_blacklist_path,'czid-public-references','seqtoid-public-references')")

    HostGenome.update_all("s3_bowtie2_index_path = replace(s3_bowtie2_index_path,'czid-public-references','seqtoid-public-references')")
    HostGenome.update_all("s3_bowtie2_index_path_v2 = replace(s3_bowtie2_index_path_v2,'czid-public-references','seqtoid-public-references')")
    HostGenome.update_all("s3_hisat2_index_path = replace(s3_hisat2_index_path,'czid-public-references','seqtoid-public-references')")
    HostGenome.update_all("s3_kallisto_index_path = replace(s3_kallisto_index_path,'czid-public-references','seqtoid-public-references')")
    HostGenome.update_all("s3_minimap2_dna_index_path = replace(s3_minimap2_dna_index_path,'czid-public-references','seqtoid-public-references')")
    HostGenome.update_all("s3_minimap2_rna_index_path = replace(s3_minimap2_rna_index_path,'czid-public-references','seqtoid-public-references')")
    HostGenome.update_all("s3_original_transcripts_gtf_index_path = replace(s3_original_transcripts_gtf_index_path,'czid-public-references','seqtoid-public-references')")
    HostGenome.update_all("s3_star_index_path = replace(s3_star_index_path,'czid-public-references','seqtoid-public-references')")
  end

  def down
    AlignmentConfig.update_all("diamond_db_path = replace(diamond_db_path,'seqtoid-public-references','czid-public-references')")
    AlignmentConfig.update_all("minimap2_long_db_path = replace(minimap2_long_db_path,'seqtoid-public-references','czid-public-references')")
    AlignmentConfig.update_all("minimap2_short_db_path = replace(minimap2_short_db_path,'seqtoid-public-references','czid-public-references')")
    AlignmentConfig.update_all("s3_accession2taxid_path = replace(s3_accession2taxid_path,'seqtoid-public-references','czid-public-references')")
    AlignmentConfig.update_all("s3_deuterostome_db_path = replace(s3_deuterostome_db_path,'seqtoid-public-references','czid-public-references')")
    AlignmentConfig.update_all("s3_lineage_path = replace(s3_lineage_path,'seqtoid-public-references','czid-public-references')")
    AlignmentConfig.update_all("s3_nr_db_path = replace(s3_nr_db_path,'seqtoid-public-references','czid-public-references')")
    AlignmentConfig.update_all("s3_nr_loc_db_path = replace(s3_nr_loc_db_path,'seqtoid-public-references','czid-public-references')")
    AlignmentConfig.update_all("s3_nt_db_path = replace(s3_nt_db_path,'seqtoid-public-references','czid-public-references')")
    AlignmentConfig.update_all("s3_nt_info_db_path = replace(s3_nt_info_db_path,'seqtoid-public-references','czid-public-references')")
    AlignmentConfig.update_all("s3_nt_loc_db_path = replace(s3_nt_loc_db_path,'seqtoid-public-references','czid-public-references')")
    AlignmentConfig.update_all("s3_taxon_blacklist_path = replace(s3_taxon_blacklist_path,'seqtoid-public-references','czid-public-references')")

    HostGenome.update_all("s3_bowtie2_index_path = replace(s3_bowtie2_index_path,'czid-public-references','seqtoid-public-references')")
    HostGenome.update_all("s3_bowtie2_index_path_v2 = replace(s3_bowtie2_index_path_v2,'czid-public-references','seqtoid-public-references')")
    HostGenome.update_all("s3_hisat2_index_path = replace(s3_hisat2_index_path,'czid-public-references','seqtoid-public-references')")
    HostGenome.update_all("s3_kallisto_index_path = replace(s3_kallisto_index_path,'czid-public-references','seqtoid-public-references')")
    HostGenome.update_all("s3_minimap2_dna_index_path = replace(s3_minimap2_dna_index_path,'czid-public-references','seqtoid-public-references')")
    HostGenome.update_all("s3_minimap2_rna_index_path = replace(s3_minimap2_rna_index_path,'czid-public-references','seqtoid-public-references')")
    HostGenome.update_all("s3_original_transcripts_gtf_index_path = replace(s3_original_transcripts_gtf_index_path,'czid-public-references','seqtoid-public-references')")
    HostGenome.update_all("s3_star_index_path = replace(s3_star_index_path,'czid-public-references','seqtoid-public-references')")
  end
end
