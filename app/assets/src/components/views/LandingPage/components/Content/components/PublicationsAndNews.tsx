import React from "react";
import { IconArrowRight } from "~ui/icons";
import cs from "./PublicationsAndNews.scss";

const Publications = () => {
  return (
    <div className={cs.publications}>
      <h2>See how RESEARCHERS are using SeqtoID</h2>
      <ul>
        <li className={`${cs.publication} ${cs.marker}`}>
          <div className={cs.liMarker}></div>
          <a
            href={`https://www.nejm.org/doi/10.1056/NEJMc2602730`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <h3 className={cs.title}>
              Bodansky, Aaron, et al. &ldquo;Neuroinvasive Trichodysplasia
              Spinulosa–Associated Polyomavirus Infection.&rdquo; New England
              Journal of Medicine 395.10 (2026): 1032-1034.
            </h3>
            <p className={cs.readMore}>
              View Paper
              <IconArrowRight />
            </p>
          </a>
        </li>
        <li className={`${cs.publication} ${cs.marker}`}>
          <div className={cs.liMarker}></div>
          <a
            href={`https://doi.org/10.1186/s13073-025-01480-2`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <h3 className={cs.title}>
              Lu D., et al. Simultaneous detection of pathogens and
              antimicrobial resistance genes with the open source, cloud-based,
              CZ ID platform. Genome Medicine. May 6, 2025.
            </h3>
            <p className={cs.readMore}>
              View Paper
              <IconArrowRight />
            </p>
          </a>
        </li>
        <li className={`${cs.publication} ${cs.marker}`}>
          <div className={cs.liMarker}></div>
          <a
            href={`https://doi.org/10.3390/pathogens14060601`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <h3 className={cs.title}>
              Mziray SR., et al. Deploying Metagenomics to Characterize
              Microbial Pathogens During Outbreak of Acute Febrile Illness Among
              Children in Tanzania. Pathogens. June 19, 2025.
            </h3>
            <p className={cs.readMore}>
              View Paper
              <IconArrowRight />
            </p>
          </a>
        </li>
        <li className={`${cs.publication} ${cs.marker}`}>
          <div className={cs.liMarker}></div>
          <a
            href={`https://doi.org/10.1186/s40168-025-02203-w`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <h3 className={cs.title}>
              Mekuria Z., et al. Host clustering of Campylobacter species and
              enteric pathogens in a longitudinal cohort of infants, family
              members and livestock in rural Eastern Ethiopia. Microbiome.
              November 3, 2025.
            </h3>
            <p className={cs.readMore}>
              View Paper
              <IconArrowRight />
            </p>
          </a>
        </li>
        <li className={`${cs.publication} ${cs.marker}`}>
          <div className={cs.liMarker}></div>
          <a
            href={`https://doi.org/10.1371/journal.pone.0315492`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <h3 className={cs.title}>
              Wanjiru T., et al. Vertical transmission of Dengue virus type-3
              and metagenomic virome profiles of Aedes aegypti mosquitoes
              collected in Kisumu, Kenya. PLOS ONE. July 2, 2025.
            </h3>
            <p className={cs.readMore}>
              View Paper
              <IconArrowRight />
            </p>
          </a>
        </li>
      </ul>
    </div>
  );
};

const News = () => {
  return (
    <div className={cs.news}>
      <h2>In the News</h2>
      <ul>
        <li className={`${cs.publication}`}>
          <a
            href={`https://www.newyorker.com/science/elements/stumped-by-a-medical-mystery-try-metagenomics`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <time className={cs.date}>08.25.26 - The New Yorker</time>
            <h3 className={cs.title}>
              Stumped by a Medical Mystery? Try Metagenomics
            </h3>
            <p className={cs.readMore}>
              Read More
              <IconArrowRight />
            </p>
          </a>
        </li>
        <li className={`${cs.publication}`}>
          <a
            href={`https://virological.org/t/initial-genomes-from-may-2026-bundibugyo-virus-disease-outbreak-in-the-democratic-republic-of-the-congo-and-uganda/1032`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <time className={cs.date}>05.26 - Virological</time>
            <h3 className={cs.title}>
              Initial genomes from May 2026 Bundibugyo Virus Disease Outbreak in
              the Democratic Republic of the Congo and Uganda, reveal a new
              spillover event
            </h3>
            <p className={cs.readMore}>
              Read More
              <IconArrowRight />
            </p>
          </a>
        </li>
        <li className={`${cs.publication}`}>
          <a
            href={`https://virological.org/t/genomic-evidence-links-the-largest-dengue-outbreak-in-senegal-to-newly-circulating-denv-2-lineage/1018`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <time className={cs.date}>12.25 - Virological</time>
            <h3 className={cs.title}>
              Genomic Evidence Links the Largest Dengue Outbreak in Senegal to
              Newly Circulating DENV-2 Lineage
            </h3>
            <p className={cs.readMore}>
              Read More
              <IconArrowRight />
            </p>
          </a>
        </li>
        <li className={`${cs.publication}`}>
          <a
            href={`https://www.genomeweb.com/sequencing/chan-zuckerberg-id-makes-strides-enabling-pathogen-identification-metagenomic-data#.ZGvEzOzMKWA`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <time className={cs.date}>05.08.23 - GenomeWeb</time>
            <h3 className={cs.title}>
              Chan Zuckerberg ID Makes Strides in Enabling Pathogen
              Identification From Metagenomic Data
            </h3>
            <p className={cs.readMore}>
              Read More
              <IconArrowRight />
            </p>
          </a>
        </li>
        <li className={`${cs.publication}`}>
          <a
            href={`https://www.nytimes.com/2021/06/03/magazine/metagenomic-sequencing.html`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <time className={cs.date}>06.03.21 - New York Times</time>
            <h3 className={cs.title}>The Disease Detective</h3>
            <p className={cs.readMore}>
              Read More
              <IconArrowRight />
            </p>
          </a>
        </li>
        <li className={`${cs.publication}`}>
          <a
            href={`https://www.nytimes.com/2021/02/16/health/coronavirus-pandemic-cambodia-manning.html?referringSource=articleShare`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <time className={cs.date}>04.02.20 - New York Times</time>
            <h3 className={cs.title}>Piecing Together the Next Pandemic</h3>
            <p className={cs.readMore}>
              Read More
              <IconArrowRight />
            </p>
          </a>
        </li>
      </ul>
    </div>
  );
};

export { Publications, News };
