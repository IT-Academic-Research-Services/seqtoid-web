# SeqToID CLI

This project is under active development and in its beta phase. It should be fairly stable but there may be some issues. If you experience an issue please [let us know](https://github.com/IT-Academic-Research-Services/seqtoid-cli/issues).

A **C**ommand **L**ine **I**nterface for [SeqToID](https://seqtoid.org/). 

SeqToID CLI is an in-house fork of https://github.com/chanzuckerberg/czid-cli (itself a rewrite of chanzuckerberg/idseq-cli), rebranded for SeqToID.

## Getting Started

### Installation

Currently only binaries are available. More types of packages coming soon.

#### Linux

There are lots of options to install on Linux.

##### Debian Distributions (ex. Debian, Ubuntu, Linux Mint)

1. Download our [latest .deb package](https://github.com/IT-Academic-Research-Services/seqtoid-cli/releases/latest/download/seqtoid-cli_linux_amd64.deb).
1. (Alternatively) Download with curl: `curl -L https://github.com/IT-Academic-Research-Services/seqtoid-cli/releases/latest/download/seqtoid-cli_linux_amd64.deb -o seqtoid-cli_linux_amd64.deb`
1. Install the package: `sudo dpkg -i seqtoid-cli_linux_amd64.deb`
1. (Optional) Remove the package file `rm seqtoid-cli_linux_amd64.deb`


##### Fedora Distributions (ex. Centos, RHEL)

1. Download our [latest .rpm package](https://github.com/IT-Academic-Research-Services/seqtoid-cli/releases/latest/download/seqtoid-cli_linux_amd64.rpm)
1. (Alternatively) Download with curl: `curl -L https://github.com/IT-Academic-Research-Services/seqtoid-cli/releases/latest/download/seqtoid-cli_linux_amd64.rpm -o seqtoid-cli_linux_amd64.rpm`
1. Install the package: `sudo rpm -i seqtoid-cli_linux_amd64.rpm`
1. (Optional) Remove the package file: `rm seqtoid-cli_linux_amd64.rpm`

##### Other Linux: Install via Homebrew for Linux

1. Make sure you have [Homebrew for Linux](https://docs.brew.sh/Homebrew-on-Linux)
1. Add the SeqToID tap: `brew tap IT-Academic-Research-Services/tap`
1. Install the package: `brew install seqtoid`

##### Other Linux: Without Homebrew

Follow the instructions for [installing from binaries](#from-binaries).

#### MacOs

seqtoid-cli is available via homebrew and natively supports Apple Silicon! (via the `darwin_arm64` binary)

##### Install via Homebrew

1. Make sure you have [Homebrew for Linux](https://docs.brew.sh/Homebrew-on-Linux)
1. Add the SeqToID tap: `brew tap IT-Academic-Research-Services/tap`
1. Install the package: `brew install seqtoid`

##### Without Homebrew

Follow the instructions for [installing from binaries](#from-binaries).

#### Windows

Follow the instructions for [installing from binaries](#from-binaries).

#### From Binaries

1. Navigate to our [latest release](https://github.com/IT-Academic-Research-Services/seqtoid-cli/releases/latest).
1. Available binaries will be under the `Assets` tab as archives (`.tar.gz` for Linux + MacOS, `.zip` for Windows)
1. Download appropriate archive for your operating system and architecture
1. Unzip the file, the `seqtoid` executable will be inside

    Linux + MacOS: `tar -xf path/to/archive.tar.gz`

    Windows: `expand-archive -path 'c:\path\to\archive.zip' -destinationpath '.\seqtoid-cli'`

1. Files with shell completions are also inside so you can move them to the appropriate place for your shell
1. To use the binary you either need to add it to your `PATH` so you can execute it as `seqtoid` or execute the binary directly with the path to the binary (i.e. `/path/to/seqtoid` on Linux + MacOS or `C:\path\to\seqtoid.exe` on windows). If you are executing the binary using it's path keep in mind that you should use the path to the seqtoid binary instead of the `seqtoid` command every time you use it.


Note on MacOS: Currently we don't sign our binary so you will need to manually remove the quarentine attribute from the binary: `sudo xattr -d com.apple.quarantine path/to/binary`


### Basic Usage

#### Setup

First log in with your SeqToID account:

```bash
seqtoid login
```

You will be prompted to log in with your SeqToID account via the web.

Accept the user agreement:

```bash
seqtoid accept-user-agreement
```

This will print the user agreement and prompt you for your agreement.

#### Upload a Single Sample

You can use the SeqToID CLI to upload samples to upload a single sample to SeqToID. You can upload a single file for single end reads or two files for paired end reads. Supported file types: `.fastq`/`.fq`/`.fasta`/`.fa`/`.fastq.gz`/`.fq.gz`/`.fasta.gz`/`.fa.gz`.

Optionally, you can create a metadata CSV file for your sample. You can skip this step and specify your metadata with command line flags. For instructions on creating this file see:

- Instructions: https://seqtoid.org/metadata/instructions
- Metadata dictionary and supported host genomes: https://seqtoid.org/metadata/dictionary
- Metadata CSV template: https://seqtoid.org/metadata/metadata_template_csv

Be sure to set the sample name in the `Sample Name` column of the CSV to the same name you pass to the `upload-sample` command with `-s`/`--sample-name`. If you would like to specify your metadata entirely with `-m` flags you don't need to include a `--metadata-csv`. If you have specified all of your metadata in the metadata csv you don't need to include any `-m` flags. `-m` flags override metadata from the csv.

Once you have set up you can use the `upload-sample` command to upload your sample to SeqToID.

**Illumina**

Linux + MacOS:

```bash
seqtoid metagenomics upload-sample \
  -p 'Project Name' \
  -s 'Sample Name' \
  --sequencing-platform Illumina \
  --metadata-csv your_metadata.csv \
  -m 'Metadata Name=Metadata Value' \
  your_sample_R1.fastq.gz your_sample_R2.fastq.gz
```

Windows:

```Powershell
seqtoid metagenomics upload-sample `
  -p "Project Name" `
  -s "Sample Name" `
  --sequencing-platform Illumina `
  --metadata-csv your_metadata.csv `
  -m "Metadata Name=Metadata Value" `
  your_sample_R1.fastq.gz your_sample_R2.fastq.gz
```

Note: The sample name is optional. If it is not included it will be computed from your input file name based on the same rules as uploading multiple samples.

**Nanopore**

Linux + MacOS:

```bash
seqtoid metagenomics upload-sample \
  --project 'Your Project ID' \
  --sample-name 'Your Sample Name' \
  --metadata-csv 'Your_metadata_file.csv' \
  --sequencing-platform 'Nanopore' \
  --guppy-basecaller-setting 'hac' \
  your_sample.fastq.gz
```

Windows:

```Powershell
seqtoid metagenomics upload-sample `
  --project "Your Project ID" `
  --sample-name "Your Sample Name" `
  --metadata-csv "Your_metadata_file.csv" `
  --sequencing-platform "Nanopore" `
  --guppy-basecaller-setting "hac" `
  your_sample.fastq.gz
```

**AMR**

Linux + MacOS:

```bash
seqtoid amr upload-sample \
  --project 'Your Project ID' \
  --sample-name 'Your Sample Name' \
  --metadata-csv 'Your_metadata_file.csv' \
  your_sample.fastq.gz
```

Windows:

```Powershell
seqtoid amr upload-sample `
  --project "Your Project ID" `
  --sample-name "Your Sample Name" `
  --metadata-csv "Your_metadata_file.csv" `
  your_sample.fastq.gz
```

#### Upload Multiple Samples

The SeqToID CLI can search a directory for read files and upload supported files as samples. Supported file types are: `.fastq`/`.fq`/`.fasta`/`.fa`/`.fastq.gz`/`.fq.gz`/`.fasta.gz`/`.fa.gz`. Sample names are computed based on the names of the files. Sample names the base name of the file with the extension, `_R1`, `_R2`, `_R1_001`, and `_R2_001` removed. If two files have the same sample name and one has `R1` and the other has `R2` the files will be uploaded to the same sample as paired reads. Since only the base name of the file and no parent directories are taken into account file names must be globally unique (except for the same sample's `R1` and `R2` files). Here are a few examples of sample names for various paths:

- `your_directory_of_samples/my_sample.fasta` => `my_sample`
- `your_directory_of_samples/sample_one/sample_one_R1.fastq.gz` => `sample_one`
- `your_directory_of_samples/sample_one/sample_one_R2.fastq.gz` => `sample_one` (pair of the above example)
- `your_directory_of_samples/some_directory/some_other_directory/sample_two_R1_001.fa.gz` => `sample_two`

This is the first pass of directory uploads and we would like to support more directory structures. If you have any suggestions for directory structure uploads [we'd love to hear from you](https://github.com/IT-Academic-Research-Services/seqtoid-cli/issues).

Optionally, you can create a metadata CSV file for your sample. You can skip this step and specify your metadata with command line flags. For instructions on creating this file see:

- Instructions: https://seqtoid.org/metadata/instructions
- Metadata dictionary and supported host genomes: https://seqtoid.org/metadata/dictionary
- Metadata CSV template: https://seqtoid.org/metadata/metadata_template_csv

To associate a row of metadata with a sample you must enter the correct sample name in the `Sample Name` column of the CSV. If you would like to specify your metadata entirely with `-m` flags you don't need to include a `--metadata-csv`. If you have specified all of your metadata in the metadata csv you don't need to include any `-m` flags. `-m` flags override metadata from the csv.

Once you have set up you can use the `upload-samples` command to upload your directory to SeqToID.

**Illumina**

Linux + MacOS:

```bash
seqtoid metagenomics upload-samples \
  -p 'Project Name' \
  --sequencing-platform Illumina \
  --metadata-csv your_metadata.csv \
  -m 'Metadata Name=Metadata Value' \
  your_directory_of_samples
```

Windows:

```Powershell
seqtoid metagenomics upload-samples `
  -p "Project Name" `
  --sequencing-platform Illumina `
  --metadata-csv your_metadata.csv `
  -m "Metadata Name=Metadata Value" `
  your_directory_of_samples
```

**Nanopore**

Linux + MacOS:

```bash
seqtoid metagenomics upload-samples \
  --project 'Your Project ID' \
  --metadata-csv 'Your_metadata_file.csv' \
  --sequencing-platform 'Nanopore' \
  --guppy-basecaller-setting 'hac' \
  your_directory_of_samples
```

Windows:

```Powershell
seqtoid metagenomics upload-samples `
  --project "Your Project ID" `
  --metadata-csv "Your_metadata_file.csv" `
  --sequencing-platform "Nanopore" `
  --guppy-basecaller-setting "hac" `
  your_directory_of_samples
```

**AMR**

Linux + MacOS:

```bash
seqtoid amr upload-samples \
  -p 'Project Name' \
  --metadata-csv your_metadata.csv \
  -m 'Metadata Name=Metadata Value' \
  your_directory_of_samples
```

Windows:

```Powershell
seqtoid amr upload-samples `
  -p "Project Name" `
  --metadata-csv your_metadata.csv `
  -m "Metadata Name=Metadata Value" `
  your_directory_of_samples
```

## Configuration

seqtoid-cli can be configured with environment variables or files. By default configurations are saved in your system's default configuration directory under a directory called `seqtoid-cli` in a yml file called `config.yml`. You can specify a custom configuration file with the `--config` flag for any command. Some commands modify your configuration like `accept-user-agreement`. These will modify whatever configuration file you specify, or the default if none are specified. Every configuration can be set as an environment variable with the prefix `SEQTOID_CLI_`. For example, the `secret` config can be set with the environment variable: `SEQTOID_CLI_SECRET`.

### Configuration Options

- `secret`: a secret used to persistently authenticate with SeqToID. Generated by running: `seqtoid login --persistent`
- `accepted_user_agreement`: set to `Y` if the user has accepted the user agreement. Setting this manually means you accept the user agreement. Also set via: `seqtoid accept-user-agreement`

## Differences from version 1

- Resume uploads that have been interrupted
- Faster uploads (on systems with high bandwidth) due to multithreading
- Distributed as a single binary for easier installation that doesn't rely on dependencies on the user's machine
- Shell completion support
- Structured with commands and subcommands to make room for future functionality
- Log in in the web via your SeqToID account instead of using a static token
- Critical bugfixes
- Uploads without the need for user prompts
- Supports configuration files and environment variable configuration instead of relying solely on flags

## Contributing

This project is not seeking contributions at this time. It is tighly coupled to the SeqToID Web App, it's features, it's APIs, and it's development goals. Please feel free to raise issues for feature requests or bugs.

This project adheres to the Contributor Covenant [code of conduct](https://www.contributor-covenant.org/). By participating, you are expected to uphold this code. Please report unacceptable behavior to SeqtoID-Support@ucsf.edu.

## Reporting Security Issues

Please note: If you believe you have found a security issue, please responsibly disclose by contacting us at security@seqtoid.org.

See [SECURITY.md](SECURITY.md) for more information.
