// Link conventions in this file:
//   "helpcenter:/path"  = SeqtoID help center link. The "helpcenter:" sentinel is a
//                         host-relative marker resolved at render by Link.tsx against
//                         the environment's helpCenterHost (from UserContext). Never a
//                         literal host here.
//   "https://..."       = external site (github, ncbi, etc.), or a legacy help.czid.org
//                         link pending SW-3. Absolute; never touched by the resolver.
//   "/path" (bare)      = internal Rails route; never touched by the resolver.
//
// WARNING: Links with the prefix help.czid.org/knowledge will not be user-accessible. Just replace /knowledge/ with /hc/en-us/ .

export const SARS_COV_2_CONSENSUS_GENOME_DOC_LINK =
  "https://help.czid.org/hc/en-us/articles/360049787632";
export const VIRAL_CONSENSUS_GENOME_DOC_LINK =
  "helpcenter:/articles/metagenomic-analysis-consensus-genome-quality-checks/";
export const NEXTCLADE_APP_LINK = "https://clades.nextstrain.org/";
export const NEXTCLADE_DEFAULT_TREE_LINK =
  "https://docs.nextstrain.org/projects/nextclade/en/latest/user/datasets.html"; // Beware of link breaking
export const NEXTCLADE_REFERENCE_TREE_LINK =
  "https://help.czid.org/hc/en-us/articles/360052479232#Uploading-to-Nextclade";
export const NEXTCLADE_TREE_FORMAT_LINK =
  "https://docs.nextstrain.org/en/latest/reference/formats/data-formats.html";
export const NEXTCLADE_TREE_ROOT_LINK =
  "https://github.com/nextstrain/ncov/blob/master/defaults/reference_seq.gb";
export const VISUALIZATIONS_DOC_LINK =
  "https://help.czid.org/hc/en-us/articles/360043062453-Creating-a-Heatmap";
export const ARTIC_PIPELINE_LINK =
  "https://artic.network/ncov-2019/ncov2019-bioinformatics-sop.html";
export const CG_ILLUMINA_PIPELINE_GITHUB_LINK =
  "https://github.com/chanzuckerberg/czid-workflows/tree/main/workflows/consensus-genome";
export const MNGS_ILLUMINA_PIPELINE_GITHUB_LINK =
  "https://github.com/chanzuckerberg/czid-workflows/tree/main/workflows/short-read-mngs";
export const MNGS_NANOPORE_PIPELINE_GITHUB_LINK =
  "https://github.com/chanzuckerberg/czid-workflows/tree/main/workflows/long-read-mngs";
export const AMR_PIPELINE_GITHUB_LINK =
  "https://github.com/chanzuckerberg/czid-workflows/tree/main/workflows/amr";
export const PHYLO_TREE_LINK =
  "https://help.czid.org/hc/en-us/articles/4404223662228";
export const PAIRWISE_DISTANCE_MATRIX_INSTEAD_OF_TREE_LINK =
  "helpcenter:/articles/why-a-pairwise-distance-matrix-instead-of-a-tree/";
export const BACKGROUND_MODELS_LINK =
  "https://help.czid.org/hc/en-us/articles/360050883054-Background-Models";
export const CG_QUALITY_CONTROL_LINK =
  "helpcenter:/articles/viral-consensus-genomes-download-consensus-genome-data/#available-intermediate-files";
export const NCBI_POLICIES_AND_DISCLAIMERS_LINK =
  "https://www.ncbi.nlm.nih.gov/home/about/policies/";
export const BLAST_HELP_LINK = "helpcenter:/articles/blast/";
export const BULK_DOWNLOAD_LINK =
  "helpcenter:/articles/metagenomic-analysis-initiate-a-bulk-download/";
export const AMR_BULK_DOWNLOAD_LINK =
  "helpcenter:/articles/download-amr-results-data/#files-found-within-antimicrobial-resistance-results-download";
export const AMR_HELP_LINK =
  "helpcenter:/categories/antimicrobial-resistance-analysis/";
export const AMR_EXISTING_SAMPLES_LINK =
  "https://docs.google.com/document/d/12a_0PQcTRbB-0JC1SMjhLvdQzhBF2Z0TZseFkoH-aRI/edit#bookmark=id.lqgywt4vgvg3";
export const AMR_DEPRECATED_HELP_LINK =
  "helpcenter:/articles/current-vs-deprecated-amr-pipelines/";
export const AMR_DATABASE_HELP_LINK =
  "helpcenter:/articles/amr-pipeline-workflow/#amr-database";
export const GUPPY_BASECALLER_HELP_LINK =
  "helpcenter:/articles/upload-nanopore-data/#guppy-basecaller";
export const CONCAT_FILES_HELP_LINK =
  "helpcenter:/articles/concatenate-sequence-files/";
export const CONCAT_FILES_HELP_LINK_ONT =
  "helpcenter:/articles/concatenate-sequence-files/#automatic-concatenation-of-nanopore-sequencing-files";
export const PROJECT_SHARING_HELP_LINK =
  "helpcenter:/articles/upload-mngs-illumina-data-through-the-web-app/#project-sharing";
export const AMR_PIPELINE_HELP_LINK =
  "helpcenter:/articles/amr-pipeline-workflow/";

export const CONTACT_US_LINK = "helpcenter:/contact";

export const HELP_CENTER_LINK = "helpcenter:/";

export const WHITE_PAPER_LINK =
  "https://academic.oup.com/gigascience/article/9/10/giaa111/5918865";

export const WORKFLOWS_CHANGELOG_LINK =
  "https://github.com/chanzuckerberg/czid-workflows/blob/main/CHANGELOG.md"; // generic link for short read mNGS and CG

// Links for pipeline version indicator
export const MNGS_ILLUMINA_UPLOAD_LINK =
  "helpcenter:/articles/upload-mngs-illumina-data-through-the-web-app/#project-selection";
export const MNGS_NANOPORE_UPLOAD_LINK =
  "helpcenter:/articles/upload-nanopore-data/#upload-data";
export const AMR_UPLOAD_LINK =
  "helpcenter:/articles/upload-or-select-data-for-amr-analysis/#upload-data-for-amr-analysis";
export const SARS_COV_2_UPLOAD_LINK =
  "helpcenter:/articles/upload-data-and-assemble-sars-cov-2-genomes-using-the-web-app/";
export const VIRAL_CONSENSUS_GENOME_UPLOAD_LINK =
  "helpcenter:/articles/upload-viral-genome-data-through-the-web-app/";
