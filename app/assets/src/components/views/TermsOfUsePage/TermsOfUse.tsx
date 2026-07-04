import React from "react";
import { Footer } from "~/components/common/Footer";
import { LandingHeader } from "~/components/common/LandingHeader";
import { NarrowContainer } from "~/components/layout";

const TERMS_STYLES = `
  .terms-notice-page { padding: 48px 0 64px; }
  .terms-notice-legal-body { font-family: inherit; }
  .terms-notice-legal-body h2 { font-size: 20px; font-weight: 700; color: #052049; margin: 32px 0 12px; }
  .terms-notice-legal-body h3 { font-size: 16px; font-weight: 600; color: #052049; margin: 24px 0 8px; }
  .terms-notice-legal-body p { font-size: 15px; line-height: 1.7; color: #374151; margin-bottom: 16px; }
  .terms-notice-legal-body ul { padding-left: 24px; margin-bottom: 16px; }
  .terms-notice-legal-body li { font-size: 15px; line-height: 1.7; color: #374151; margin-bottom: 8px; }
  .terms-notice-legal-body a { color: #006BE9; text-decoration: none; }
  .terms-notice-legal-body a:hover { text-decoration: underline; }
  .terms-notice-legal-body strong { font-weight: 600; color: #1a202c; }
  .terms-notice-warning { background: #fffbeb; border: 1px solid #f59e0b; border-radius: 8px; padding: 16px 20px; margin: 24px 0; }
  .terms-notice-warning p { color: #92400e; font-size: 14px; margin: 0; }
`;

export function TermsOfUse() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: TERMS_STYLES }} />
      <LandingHeader legalNav />
      <NarrowContainer size="small" className="terms-notice-page">
        <div className="terms-notice-legal-body">
        <div className="terms-notice-warning">
          <p><strong>PLEASE BE ADVISED THAT THIS AGREEMENT CONTAINS AN ARBITRATION PROVISION IN SECTION 9 BELOW THAT AFFECTS YOUR RIGHTS UNDER THIS AGREEMENT.</strong> EXCEPT FOR CERTAIN TYPES OF DISPUTES MENTIONED IN THAT PROVISION, YOU AND UCSF (AS DEFINED BELOW) AGREE THAT (1) DISPUTES BETWEEN US WILL BE RESOLVED BY INDIVIDUAL BINDING ARBITRATION, AND (2) YOU AND UCSF (AND ITS PARTNERS AND AFFILIATES) WAIVE ANY RIGHT TO PARTICIPATE IN A CLASS-ACTION LAWSUIT, CLASS-WIDE ARBITRATION, OR ANY OTHER REPRESENTATIVE ACTION.</p>
        </div>

        <p>Please read these Terms of Use ("Terms") before using SeqToID ("Services" or "SeqToID"). SeqToID is owned by The Regents of the University of California and operated by the University of California, San Francisco (UCSF) (together, "UCSF", "we", "us" or "our"). These Terms are entered into between UCSF and you ("User" or "you") and govern your use of SeqToID. SeqToID is comprised of our research portal, any associated online services or platforms that link to or refer to these Terms, and any databases or data accessible through the portal, associated services or platforms. SeqToID is designed to enable the research community to investigate pathogens using metagenomic sequencing data and to help further the study of infectious diseases.</p>

        <p>Please carefully read these terms and indicate your acceptance by registering for SeqToID. If you do not agree to these Terms, do not register for an account or use SeqToID. For more information about our privacy practices, please see our <a href="/privacy">Privacy Notice</a>.</p>

        <h2>Summary of Key Things to Know</h2>

        <ul>
          <li>SeqToID does not provide medical advice. The Output from SeqToID does not constitute and should not be relied upon to provide medical advice, diagnosis or treatment. It is intended for research, educational, or informational purposes only.</li>
          <li>You must ensure that all personally-identifying information and Protected Health Information is fully removed from Sample Metadata (defined below) before it is uploaded to SeqToID.</li>
          <li>You are responsible for obtaining the permissions necessary to collect and submit the Upload Data (defined below). You represent that you have obtained, and will maintain, all consents, permissions, and authorizations needed to collect, share, use, and export Upload Data within SeqToID, and for SeqToID to use and share the information as described in its <a href="/privacy">Privacy Notice</a>.</li>
          <li>You may not attempt to re-identify Upload Data. By using SeqToID, you agree that you will not attempt to re-identify any Upload Data with a person, and you will not disclose any Upload Data of other Users downloaded from the Database except for the limited purposes described in these Terms.</li>
          <li>You own any Outputs you create with your Report Data, such as consensus genomes and phylogenetic trees for pathogens of interest. However, please note that UCSF will also have its own rights in the Output as described below.</li>
        </ul>

        <h2>About SeqToID</h2>

        <p>Here&apos;s how SeqToID works: Users submit Upload Data (as described below). This data may contain human and non-human genetic sequences ("Raw Sample Data" as further defined below), as well as information about those sequences, such as the date the sample was collected and the species it was collected from ("Sample Metadata" as further defined below). For example, a researcher might upload genetic information from mosquitoes, which are often a source of infectious disease, or from humans, who can be infected by such diseases. SeqToID then processes this Upload Data in order to identify pathogens found within the genetic sequence (e.g., the mosquito may be carrying the chikungunya virus).</p>

        <p>"Upload Data" is data that Users upload to SeqToID (other than the information Users provide during registration to create an account). Upload Data consists of genetic sequence information (human or non-human) and metadata about those genetic sequences (such as time and location of sample collection). Upload Data includes Raw Sample Data and Sample Metadata.</p>

        <p>"Raw Sample Data" is full genetic sequence data uploaded by Users. Genetic sequence data contains genetic information about pathogens in the sample and of the host from which the sample was taken. The host could be a human or non-human (e.g., mosquito). You should not be able to find any human sequence data in SeqToID other than those embedded in samples you yourself have uploaded. This is because we filter out and discard host sequence data in order to generate the Report Data.</p>

        <p>"Sample Metadata" includes information related to the Raw Sample Data, such as the host type (e.g., human or mosquito), upload date, and tissue type and free-text research notes entered by Users. This data should not include personally-identifying information regarding the individual to whom the Raw Sample Data relates.</p>

        <p>"Report Data" is information SeqToID produced from Upload Data. We generate Report Data by processing Upload Data through our Data Pipeline. SeqToID&apos;s "Data Pipeline" cleans (e.g., by removing duplicate nucleotides) and analyzes (e.g., by matching Raw Sample Data nucleotide sequences with known pathogen sequences) the Upload Data. Report Data may include, for example, data about the pathogen sequences identified in the Raw Sample Data and the frequency of such identification ("Pathogen Data") or raw numeric counts of non-personally identifying gene expression profiles that were found in the Raw Sample Data ("Gene Counts").</p>

        <p>"Database" refers to both the data and database(s) of SeqToID.</p>

        <h2>1. Upload and Report Data.</h2>

        <p><strong>Use of Your Upload Data.</strong> We need limited rights to your Upload Data solely in order to offer SeqToID for you and other Users. Specifically, you grant to us a worldwide, non-exclusive, royalty-free, transferable (in accordance with Section 11.2 below), perpetual and irrevocable (except as set forth herein), license (with the right to grant further licenses) to use, reproduce, distribute, display, and create derivative works (e.g. phylogenetic trees) from Upload Data in connection with providing, developing and improving SeqToID. You may request deletion of your Upload Data from SeqToID by emailing <a href="mailto:seqtoid@ucsf.edu">seqtoid@ucsf.edu</a> and including a description of your Upload Data that you wish to have removed. We will delete the requested Upload Data within the timelines set forth under applicable privacy laws. Please note, that our removal of your Upload Data from SeqToID will not impact any use of Upload Data by others you may have chosen to share it with prior to the effective date of removal and we are not able to require others Users to stop using Upload Data they accessed or downloaded prior to removal. More information about Upload Data can be found in our <a href="/privacy">Privacy Notice</a>.</p>

        <p><strong>Use and Visibility of Your Report Data.</strong> You understand that your Report Data is data generated by SeqToID, does not contain personally-identifying information (i.e. personal data) and may be shared with UCSF and with other SeqToID Users in accordance with your preferences in order to further SeqToID&apos;s mission and advance the study of infectious diseases.</p>

        <p>You represent and warrant to us and our service partners that (A) your provision of the Upload Data to SeqToID complies with all applicable laws, rules, and regulations ("Applicable Law") and industry guidelines and ethical standards that apply to you ("Applicable Standards"), and you will otherwise comply with all Applicable Law in connection with SeqToID; (B) you have all consents, permissions, and authorizations necessary and sufficient to upload, share, use, and export the Upload Data to us for the purposes described in these Terms and in our Privacy Notice and to grant the rights and permissions herein; and (C) the Upload Data — and our use of the Upload Data in accordance with these Terms and our Privacy Notice — does not and will not violate Applicable Law or infringe or violate any third party rights.</p>

        <p>TO THE EXTENT UPLOAD DATA IS OBTAINED FROM A HUMAN, YOU AGREE NOT TO PROVIDE UPLOAD DATA IN A FORM THAT CAN IDENTIFY (DIRECTLY OR INDIRECTLY TAKING INTO ACCOUNT ALL THE MEANS REASONABLY LIKELY TO BE USED) THE PERSON TO WHOM THE DATA RELATES OR THAT CONSTITUTES OR WOULD CONSTITUTE "PROTECTED HEALTH INFORMATION" SUBJECT TO THE U.S. HEALTH INSURANCE PORTABILITY AND ACCOUNTABILITY ACT ("HIPAA"), OR OTHER "PERSONAL INFORMATION" OR "PERSONAL DATA" UNDER APPLICABLE STATE AND FEDERAL LAWS. For example, the Upload Data shall not include any personal identifiers, including without limitation name, address, dates, telephone numbers, e-mail addresses, or medical health records.</p>

        <p>To the extent that any Upload Data is obtained from a human data subject, you also specifically represent and warrant to us and our service partners that (A) you have provided any required notice to, and obtained any necessary informed consent of, any such person for the collection, use, and provision to SeqToID of the Upload Data; and (B) your provision of the Upload Data to SeqToID is covered under all such notices and consents, as well as Applicable Standards and Applicable Law. Please note that we filter out and discard human sequence data as part of generating Report Data because we don&apos;t need this data for SeqToID.</p>

        <h2>2. Authorization To Use SeqToID.</h2>

        <p>Subject to and conditioned on your compliance with these Terms, we grant you permission to access and use SeqToID in accordance with Applicable Law, solely for your own internal academic or internal scientific research purposes. You may not permit any third party to access or use or "share" your Account. All persons wishing to access the Services must create their own separate account and agree to these Terms. You are solely responsible for the activity that occurs on your Account, you will keep your account credentials secure, and you will not share your password(s) and/or any other account credentials with anyone else.</p>

        <p>SeqToID may not be used to provide medical or other services to any third party (for instance, to inform or provide disease diagnoses). SeqToID is not intended to diagnose, treat, cure, or prevent any disease and is not a substitute for medical advice.</p>

        <p>You shall not disclose or distribute the Database, in whole or in part, or any works derived from the Database to any third party for any purpose, except for the following:</p>
        <ul>
          <li>You may disclose the documents that you download from the Database using SeqToID&apos;s intended functionality to your employees and agents who are registered Users of the Services and who are engaged in conducting your research ("Research Associates") for the sole purpose of carrying out your internal research. Your Research Associates must also agree to use SeqToID and Database in accordance with these Terms.</li>
          <li>You may share research findings derived from use of SeqToID to others, including with the public, so long as these findings include no personally-identifying information and you comply with Applicable Law and these Terms.</li>
          <li>You may disclose the Database to the minimum extent necessary to comply with Applicable Law or court order, so long as you promptly notify us prior to making such disclosure (to the extent Applicable Law and court order permit you to so notify us).</li>
        </ul>

        <h2>3. Acceptable Use.</h2>

        <p>You shall not, and shall not permit any third party to:</p>
        <ul>
          <li>Re-identify or attempt to re-identify any Database records or content for any purpose, including without limitation to make employment decisions or to make eligibility, coverage, underwriting, premium-setting or other decisions with respect to insurance;</li>
          <li>Access or use, or attempt to access or use, SeqToID to take any action that could harm us, SeqToID or its Users, or any third party, or use SeqToID in any manner that violates Applicable Law or infringes or otherwise violates third party rights;</li>
          <li>Include in the Sample Metadata any personally-identifying information regarding the individual to whom the Raw Sample Data relates;</li>
          <li>Share SeqToID with unauthorized individuals or otherwise provide SeqToID access to unauthorized individuals;</li>
          <li>Share your user account with any other individual, assume a false identity, or mask the identity of an account or machine without permission;</li>
          <li>Disassemble, reverse engineer, decode, or decompile any part of SeqToID or license or resell or modify any part of SeqToID;</li>
          <li>Use any automated or non-automated means to access SeqToID for data scraping;</li>
          <li>Use SeqToID in any manner that impacts the stability of the servers or the operation or performance of SeqToID or any User&apos;s use of SeqToID;</li>
          <li>Copy, rent, lease, sell, loan, transfer, assign, sublicense, resell, distribute, modify, alter, or create derivative works of any part of SeqToID or any of our intellectual property;</li>
          <li>Use SeqToID in any manner that (i) violates any Applicable Law, contractual obligation, or right of any person, (ii) is fraudulent, false, deceptive, or defamatory, (iii) promotes hatred, violence, or harm against, or (iv) otherwise may be harmful or objectionable to us or any other third party;</li>
          <li>Use SeqToID in competition with us, to develop competing products or services, for benchmarking or competitive analysis of SeqToID, or otherwise to our detriment or disadvantage;</li>
          <li>Bypass the measures we may use to prevent or restrict access to SeqToID;</li>
          <li>Access any content available on or via SeqToID through any technology or means other than those provided by SeqToID or authorized by us;</li>
          <li>Attempt to interfere with, compromise the system integrity or security of, or decipher any transmissions to or from, the servers running SeqToID;</li>
          <li>Transmit invalid data, viruses, worms, or other software agents through SeqToID; or</li>
          <li>Refer to us or to SeqToID in a manner that could imply a relationship that involves endorsement, affiliation, or sponsorship between you (or a third party) and us without our consent.</li>
        </ul>

        <p>You represent and warrant that you are a natural person of legal age who is competent and able to enter into and carry out these Terms, and, if you are using SeqToID on behalf of any entity, that you are authorized to enter into these Terms on such entity&apos;s behalf and that such entity agrees to be responsible to us if you or that entity violates these Terms.</p>

        <p>We may restrict or terminate your access to SeqToID at any time, including for breach of these Terms. In such case we will attempt to provide you notice through the contact information we have for you.</p>

        <h2>4. Registration And Payment.</h2>

        <p>To access SeqToID you will need to be a registered "User." At registration, you will be asked to provide certain information ("Account Information") to create an individual user account (an "Account"). You agree that you will not create more than one Account, or create an Account for anyone other than yourself. You may not share your Account credentials.</p>

        <p>You agree to keep your Account Information accurate and up-to-date. You agree that we may send to the e-mail address you provide us or otherwise electronically deliver notices or communications regarding SeqToID, including notices of updates to these terms and the Privacy Notice.</p>

        <p><strong>Fees.</strong> The Services or certain features of the Services may be provided for a fee or other charge. You shall pay UCSF the fees ("Fees") identified in an applicable Order (defined below) without offset or deduction at the cadence identified in the applicable Order (e.g., monthly or annually). Fees paid by you are non-refundable. You shall make all payments hereunder in US dollars by a mutually agreed-upon payment method. If you pay via invoice, you will pay the invoice within thirty (30) days of the invoice date. If you pay via credit card, you authorize us to charge your credit card for all Fees. If your payment cannot be completed, we may suspend your access to the Services until payment is received. "Order" means an ordering document, online order form, or statement of work that references these Terms and is executed by you and UCSF.</p>

        <p><strong>Taxes.</strong> All Fees and other amounts payable by you under these Terms are exclusive of taxes and similar assessments. You are responsible for all sales, use, and excise taxes, and any other similar taxes, duties, and charges of any kind imposed by any federal, state, or local governmental or regulatory authority on any amounts payable by you hereunder, other than any taxes imposed on UCSF&apos;s income. You will be responsible for paying all taxes associated with your purchases and/or subscriptions in connection with the Services.</p>

        <h2>5. Changes To SeqToID Or These Terms.</h2>

        <p><strong>Changes to SeqToID.</strong> We may, from time to time, withdraw, suspend, change or update SeqToID (including the Database) or its features without notice, subject to Applicable Law. Neither we, nor our service providers, will be liable if all or any part of SeqToID is unavailable or changes at any time.</p>

        <p><strong>Changes to these Terms.</strong> We may update these Terms from time to time and will notify you of material changes to the Terms, prior to their becoming effective. If you do not agree to the updated Terms, your remedy will be to close your Account prior to the effective date of those changes.</p>

        <p><strong>Closing Your Account.</strong> You can close your Account at any time. Just contact us via our service desk at <a href="mailto:seqtoid@ucsf.edu">seqtoid@ucsf.edu</a>.</p>

        <h2>6. Intellectual Property And Security.</h2>

        <h3>Intellectual Property Rights.</h3>

        <p><strong>Ownership of SeqToID.</strong> Subject to these Terms, we grant you a limited right to access SeqToID, and we reserve all other of our intellectual property rights in SeqToID. Using SeqToID does not give you any ownership in SeqToID, the Data Pipeline, Database, our services or the content or information made available through SeqToID that is not already yours or that is not your Upload Data or Report Data. Trademarks and logos used in connection with SeqToID are the trademarks of their respective owners. Our logos and other trademarks, service marks, graphics, and logos used for our services are trademarks or registered trademarks of ours and these Terms do not grant you any rights to use them. You agree not to use the UC name, abbreviation of the UC name, trade names, and/or trademarks (i.e., logos and seals) or any derivation thereof (collectively, "UC Name"), in any form or manner in advertisements, reports, or other information released to the public, without UC&apos;s prior written approval. You agree to comply at all times with California Education Code Section 92000.</p>

        <p><strong>Ownership of Upload Data.</strong> You (and your licensors) retain all rights, title and interest in and to the Upload Data you submit to SeqToID. Uploading data to SeqToID does not transfer ownership of your underlying Upload Data to UCSF. Just because you upload data to SeqToID, you are not giving us any ownership of your intellectual property rights to your Uploaded Data (see Section 1.1 above). Subject to the terms and conditions herein, you and your licensors continue to be the exclusive owner of Upload Data.</p>

        <p><strong>Ownership of Output.</strong> All Report Data, processed outputs produced by SeqToID from your Upload Data (including consensus genomes, phylogenetic trees, annotations, visualizations, and other derived outputs) (collectively, "Output") is owned by you, subject to the following terms and conditions:</p>

        <p><strong>UCSF Rights:</strong> Except as otherwise agreed in writing, UCSF will also own its own copy of the Output. For the avoidance of doubt, UCSF will have the right to use, reproduce, display, perform, sublicense, and distribute the Output for non-exclusive research, public-health, educational, operational, and internal purposes. UCSF will ensure such activities complies with these Terms, applicable law, University&apos;s institutional policies, any prior rights of third parties, and any available sharing choices you made at upload.</p>

        <p><strong>Institutional stewardship and operational license:</strong> To operate, maintain, improve, and secure the Services (including for quality assurance, aggregated research, and public-health uses), you grant UCSF a non-exclusive, worldwide, royalty-free, transferable (for purposes of operational transitions), license to store, process, display, analyze, and use the Report Data and related metadata consistent with this Privacy Notice and these Terms. This license also permits UCSF to make the Report Data available to other SeqToID Users or third parties to the extent you have opted into such sharing, and, in emergency public-health circumstances, to share as required or permitted by applicable law and funder obligations.</p>

        <p><strong>Commercialization and benefit-sharing:</strong> Any commercial development, invention or material commercial benefit arising from use of Output (including derivatives) will be managed in accordance with applicable University of California policies and procedures (including Technology Transfer / Innovation offices). If Output contributed or co-developed by you is the subject of material commercial development, UCSF will follow UC policies for disclosure, negotiation, and benefit-sharing and will notify you per the Terms. Nothing in these Terms confers on UCSF any right to sell your Upload Data. Commercial uses of Output will be subject to UC policy and, where appropriate, separate agreements.</p>

        <p><strong>Feedback.</strong> We&apos;d love your feedback about how to improve SeqToID at <a href="mailto:seqtoid@ucsf.edu">seqtoid@ucsf.edu</a>. That said, by giving us feedback, you agree that we can use and share it for any purpose without compensation to you. You agree that we are not required to use your feedback.</p>

        <p><strong>Security.</strong> You will establish, implement, and maintain appropriate physical, technical and organizational measures that are designed to: (a) protect the security and integrity of any network or system used to access SeqToID, including any Database records; and (b) guard against the accidental or unauthorized access, use, alteration or disclosure of SeqToID through your Account. Please notify us immediately at <a href="mailto:seqtoid@ucsf.edu">seqtoid@ucsf.edu</a> if you suspect your Account has been compromised or are aware of any other security issues relating to SeqToID.</p>

        <h2>7. Disclaimers.</h2>

        <p>In order to further infectious disease research, we rely upon Users to upload data to the Database. We and our service providers do not review or correct any data uploaded into SeqToID. If you would like to report any issue with SeqToID or the Database please contact us at <a href="mailto:seqtoid@ucsf.edu">seqtoid@ucsf.edu</a>. Except as otherwise provided in these Terms or the applicable Order, SeqToID is not intended as a storage service. UCSF will delete Uploaded Data promptly after processing, so please back up your Upload Data using a secure service of your choice.</p>

        <p>TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW:</p>

        <p>YOUR ACCESS AND USE SEQTOID AT YOUR SOLE RISK AND AGREE THAT WE AND OUR SERVICE PROVIDERS WILL NOT BE RESPONSIBLE FOR ANY ACTIONS YOU TAKE BASED ON SEQTOID OR FOR ANY INACCURATE DATA OR OUTPUTS OF SEQTOID (INCLUDING MISIDENTIFICATION OF — OR THE FAILURE TO IDENTIFY — DISEASE SEQUENCES).</p>

        <p>SEQTOID IS PROVIDED "AS IS" WITH ALL FAULTS, AND WE AND OUR SERVICE PROVIDERS HEREBY DISCLAIM ALL REPRESENTATIONS AND WARRANTIES, EXPRESS, STATUTORY, OR IMPLIED (INCLUDING, WITHOUT LIMITATION, IMPLIED WARRANTIES OF TITLE, NON-INFRINGEMENT, MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND ALL WARRANTIES ARISING FROM THE COURSE OF DEALING, USAGE, OR TRADE PRACTICE) WITH RESPECT TO SEQTOID. SEQTOID IS NOT INTENDED TO BE USED AND SHOULD NOT BE USED AS A MEDICAL DEVICE OR FOR PURPOSES OF MEDICAL DIAGNOSIS OR TREATMENT.</p>

        <p>FOR CLARITY AND WITHOUT LIMITING THE FOREGOING, WE AND OUR SERVICE PROVIDERS DO NOT MAKE ANY GUARANTEES (I) REGARDING THE ACCURACY, COMPLETENESS, TIMELINESS, SECURITY, AVAILABILITY OR INTEGRITY OF SEQTOID, (II) THAT SEQTOID WILL BE UNINTERRUPTED OR OPERATE IN COMBINATION WITH ANY SOFTWARE, SERVICE, SYSTEM OR OTHER DATA, OR (III) THAT SEQTOID WILL MEET ANY REQUIREMENTS OF ANY PERSON OR ENTITY, OR ANY REGULATORY APPROVALS OR REQUIREMENTS. WITHOUT LIMITATION, YOU ACKNOWLEDGE THAT SEQTOID IS NOT A BUSINESS ASSOCIATE FOR PURPOSES OF HIPAA.</p>

        <h2>8. Indemnification, Limitation Of Liability, And Choice Of Law.</h2>

        <p>To the maximum extent permitted by Applicable Law, you agree to indemnify and hold harmless UCSF, its affiliates, and their successors, assigns, officers, directors, employees, and agents (collectively, the "UCSF Protected Parties") from and against any and all liabilities, costs, damages, charges, losses, penalties, judgments, settlements, and expenses (including reasonable attorney&apos;s fees) ("Losses") arising out of or related to any suit, demand, action, proceeding, or other claim by a third party ("Claims") arising out of or relating to: (a) your actual or alleged failure to comply with Applicable Law or these Terms, (b) your Upload Data, (c) your breach of any representations or warranties set forth in these Terms, or (d) your actual or alleged violation of any third party rights.</p>

        <p>LIMITATION OF LIABILITY. TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, THE UCSF PROTECTED PARTIES WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, PUNITIVE, OR CONSEQUENTIAL DAMAGES OF ANY KIND (INCLUDING LOST PROFITS, LOST DATA, BUSINESS INTERRUPTION, OR LOSS OF GOODWILL) IRRESPECTIVE OF WHETHER SUCH DAMAGES ARISE FROM CLAIMS BROUGHT IN CONTRACT, TORT, NEGLIGENCE, WARRANTY, STRICT LIABILITY, OR ANY OTHER THEORY AT LAW OR IN EQUITY, AND EVEN IF ANY UCSF PROTECTED PARTY HAS BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES. WITHOUT LIMITING THE FOREGOING, TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT WILL THE UCSF PROTECTED PARTIES&apos; AGGREGATE LIABILITY ARISING OUT OF OR RELATING TO THESE TERMS OR SEQTOID EXCEED USD $100. THE EXCLUSIONS AND LIMITATIONS SET FORTH IN THIS SECTION 8 DO NOT APPLY TO LOSSES ARISING FROM A UCSF PROTECTED PARTY&apos;S GROSS NEGLIGENCE OR WILLFUL MISCONDUCT. IF ANY LIMITATION IN THIS SECTION 8 IS UNENFORCEABLE IN ANY INSTANCE, THEN SUCH LIMITATION WILL APPLY TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW.</p>

        <p>SOME LAWS DO NOT ALLOW THE LIMITATION OR EXCLUSION OF LIABILITY, SO THESE LIMITS MAY NOT APPLY TO YOU.</p>

        <p><strong>Choice of Law / Jurisdiction / Venue.</strong> These Terms, and all matters arising out of or relating to these Terms, whether sounding in contract, tort, or statute, will be governed by, and construed in accordance with, the laws of the State of California and/or applicable federal law (including the Federal Arbitration Act), without regard to conflict of law provisions. Subject to and without waiver of the arbitration provisions below, and unless prohibited by the laws of your country, you agree that any judicial proceedings (other than small claims actions as discussed above) will be brought in and you hereby consent to the exclusive jurisdiction and venue in the state courts in the City and County of San Francisco, California, or federal court for the Northern District of California. For countries where this is not permissible, this won&apos;t deprive you of any protection you have under the law of the country where you live, or access to the courts in that country.</p>

        <h2>9. ARBITRATION AGREEMENT AND CLASS ACTION WAIVER.</h2>

        <p>THIS SECTION CONSTITUTES AN ARBITRATION AGREEMENT ("Arbitration Agreement"); IT REQUIRES YOU AND UCSF AND ITS AFFILIATES (COLLECTIVELY, THE "UCSF Parties") TO AGREE TO RESOLVE ALL DISPUTES BETWEEN US THROUGH BINDING INDIVIDUAL ARBITRATION, SO PLEASE READ IT CAREFULLY.</p>

        <p><strong>Applicability.</strong> You and the UCSF Parties agree that all Disputes (defined below), including Enforceability Disputes (defined below), will be resolved exclusively in binding arbitration on an individual basis, except that you and the UCSF Parties are not required to arbitrate IP Disputes. Notwithstanding the foregoing, either you or the UCSF Parties may bring an individual action in small claims court.</p>

        <p>A "Dispute" means a dispute, claim or controversy arising out of or relating to the UCSF Parties&apos; products or these Terms; or whether that dispute is (1) based on past, present or future events; and (2) in contract, warranty, state, regulation, or other legal or equitable basis.</p>

        <p>An "Enforceability Dispute" means a Dispute relating to the interpretation, applicability, or enforceability of this Arbitration Agreement, including the formation of the contract, the arbitrability of any Dispute, and any claim that all or any part of this agreement is void or voidable.</p>

        <p>An "IP Dispute" means a Dispute relating to the ownership or enforcement of intellectual property rights.</p>

        <h3>Waivers.</h3>

        <p><strong>Waiver of Jury Right.</strong> YOU AND THE UCSF PARTIES ARE EXPRESSLY GIVING UP ALL RIGHTS TO A JURY TRIAL OR COURT TRIAL BEFORE A JUDGE. The arbitrator&apos;s decision will be final and binding on both you and us, subject to review solely on the grounds set forth in the Federal Arbitration Act ("FAA").</p>

        <p><strong>Waiver of Class or Consolidated Actions.</strong> YOU AND THE UCSF PARTIES AGREE THAT ALL DISPUTES MUST BE ARBITRATED OR LITIGATED ON AN INDIVIDUAL BASIS AND NOT ON A CLASS, COLLECTIVE ACTION, OR REPRESENTATIVE BASIS. The validity of this waiver — and whether an action may proceed as a class, collective or representative action — must be decided by a court.</p>

        <h3>Initiating a Dispute.</h3>

        <p>To initiate a Dispute, a party must send to the other party written notice of that Dispute containing: (a) the name, address, and contact information of the party giving notice; (b) the facts giving rise to the Dispute; and (c) the relief requested.</p>

        <p>You and we agree that we shall (in good faith) meet and attempt to resolve the Dispute within 30 days. If the Dispute is not resolved during that time period, then you and a representative of the applicable UCSF Party shall (in good faith) meet and attempt to resolve the Dispute through non-binding mediation with a mutually agreed-upon mediator within 30 additional days. If you and we do not reach an agreement to resolve the dispute within that 60-day period, you or we may commence an arbitration proceeding or file a claim in small claims court.</p>

        <h3>Arbitration Rules and Procedure.</h3>

        <p><strong>Rules.</strong> The FAA governs the interpretation and enforcement of this Arbitration Agreement. Judicial Arbitration &amp; Mediation Services, Inc. ("JAMS") will administer the arbitration before a single arbitrator, and the arbitration will be initiated and conducted according to the Streamlined Arbitration Rules and Procedures (the "JAMS Rules"), to the extent they are not inconsistent with the terms of this agreement. The JAMS Rules and instructions about how to initiate an arbitration are available at <a href="https://www.jamsadr.com/rules-streamlined-arbitration" target="_blank" rel="noopener noreferrer">https://www.jamsadr.com/rules-streamlined-arbitration</a> or 1-800-352-5267.</p>

        <p><strong>Fees.</strong> Pursuant to the JAMS Consumer Arbitration Minimum Standards, the UCSF Parties will bear all costs of the arbitration (including any JAMS Case Management Fee and all professional fees for the arbitrator&apos;s services), except for the filing fee if you are the party initiating the arbitration.</p>

        <p><strong>Manner and Location of Arbitration.</strong> You may choose to have the arbitration conducted by telephone, in writing, online, or in person. If in person, you may choose to have the arbitration conducted (a) in San Francisco County, California, (b) in the county where you live, or (c) at another location that you and we agree upon.</p>

        <p><strong>Confidentiality.</strong> All aspects of the arbitration, including without limitation the record of the proceeding, are confidential and will not be open to the public, except (a) to the extent both parties agree otherwise in writing, (b) as may be appropriate in any subsequent proceedings between the parties, or (c) as may otherwise be appropriate in response to a governmental agency or legal process, provided that the party upon whom such process is served shall give immediate notice of such process to the other party and afford the other party an appropriate opportunity to object to such process.</p>

        <p><strong>Opt-Out.</strong> You may opt out of this Arbitration Agreement by notifying us by mail no later than 30 days after first becoming subject to it. Your notice must include your name, address, and a clear statement that you want to opt out of this Arbitration Agreement.</p>

        <p><strong>Severability.</strong> If any portion of this Arbitration Agreement is found to be unlawful, void or for any reason unenforceable, then that portion shall be severed and the remainder of this Arbitration Agreement shall be given full force and effect.</p>

        <h2>10. Legal Compliance</h2>

        <p><strong>Export Control.</strong> You will comply with all applicable import and export and re-export control and trade and economic sanctions laws and regulations, including the Export Administration Regulations maintained by the U.S. Department of Commerce, trade and economic sanctions maintained by the U.S. Treasury Department&apos;s Office of Foreign Assets Control ("OFAC"), and the International Traffic in Arms Regulations maintained by the U.S. State Department. You represent and warrant that you are not, and that no person to whom you make SeqToID available or that is acting on your behalf, or, if you are an organization, that no person or entity owning 50% or more of your equity securities or other equivalent voting interests, is (a) listed on the List of Specially Designated Nationals and Blocked Persons or on any other list of sanctioned, prohibited, or restricted parties administered by OFAC or by any other governmental entity, or (b) located in, a national or resident of, or a segment of the government of, any country or territory for which the United States maintains trade or economic sanctions or embargoes or that has been designated by the U.S. Government as a "terrorist supporting" region.</p>

        <p><strong>Bulk Data Rule Compliance.</strong> You shall not access or use SeqToID, or permit any third party to do so, if you or such third party are a "covered person," are located in, organized under the laws of, or ordinarily resident in a "country of concern" as defined in 28 CFR § 202.303, or if such access or use would constitute a "covered data transaction" involving "bulk human &apos;omic data" in violation of the U.S. Department of Justice Bulk Sensitive Data Rule. By accessing or using SeqToID, you represent and warrant that neither you nor any third party you permit to use SeqToID fall into these categories, and that your use will not cause UCSF to violate any Applicable Law regarding bulk human &apos;omic data.</p>

        <h2>11. Miscellaneous.</h2>

        <p><strong>Severability.</strong> In the event any part of these Terms is deemed unenforceable, the remaining portion will remain in effect and you and we expressly authorize a court of competent jurisdiction to make the modifications that are necessary to comply with existing law, in a manner most closely representing the original intent of you and us as expressed in these Terms.</p>

        <p><strong>Assignment.</strong> You may not assign or delegate your rights or obligations under these Terms, in whole or in part, without our prior written approval (not to be unreasonably withheld); any assignment or delegation in violation of this provision will be null and void. We may assign our rights or delegate our obligations under these Terms. In the event of an assignment by us, we will provide you notice through the Services or contact information you have provided to us and these Terms shall otherwise remain in full force and effect and shall bind the permitted assignee.</p>

        <p><strong>Amendment.</strong> No waiver of any of the provisions of the Terms will constitute a waiver of any other provision (whether or not similar). No waiver will be binding unless executed in writing by the party to be bound by the waiver.</p>

        <p><strong>Entire Agreement.</strong> These Terms (along with the Privacy Notice) constitute the entire agreement between you and us regarding SeqToID. If you wish to modify these Terms, any amendment must be provided to us in writing and signed by our authorized representative.</p>

        <h2>12. Contact Information.</h2>

        <p>If you have any questions, comments, or concerns with Terms, you may contact us at <a href="mailto:seqtoid@ucsf.edu">seqtoid@ucsf.edu</a></p>

        <p>Our mailing address is:</p>
        <p>
          SeqToID Administrator<br />
          1855 Folsom St, Suite 601<br />
          San Francisco, CA 94143<br />
          USA
        </p>
      </div>
      </NarrowContainer>
      <Footer />
    </>
  );
}

export default TermsOfUse;
