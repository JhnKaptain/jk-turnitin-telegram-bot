import json, sys, os
from docx import Document
from docx.shared import Pt, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH
OUT=sys.argv[1]
CITES_APA=[
 "Brophy, R. H., & Fillingham, Y. A. (2022). AAOS clinical practice guideline summary: Management of osteoarthritis of the knee (nonarthroplasty). Journal of the American Academy of Orthopaedic Surgeons, 30(9), e721–e729. https://doi.org/10.5435/JAAOS-D-21-01233",
 "Moseng, T., Vliet Vlieland, T. P., Battista, S., & Østerås, N. (2024). EULAR recommendations for the non-pharmacological core management of hip and knee osteoarthritis: 2023 update. Annals of the Rheumatic Diseases, 83(6), 730–740.",
 "Porter, L. (2016). Young children's behaviour: Guidance approaches for early childhood educators (4th ed.). Allen & Unwin.",
 "World Health Organization. (2021). Musculoskeletal health. https://www.who.int/news-room/fact-sheets/detail/musculoskeletal-conditions",
 "Smith, M. H., & Berman, J. R. (2022). What is rheumatoid arthritis? JAMA, 327(12), 1194. https://doi.org/10.1001/jama.2022.0786",
]
CITES_MLA=[
 "Brophy, Robert H., and Yale A. Fillingham. \"AAOS Clinical Practice Guideline Summary: Management of Osteoarthritis of the Knee.\" Journal of the American Academy of Orthopaedic Surgeons, vol. 30, no. 9, 2022, pp. e721–29.",
 "Elliott, Anthony. The Routledge Companion to Social Theory. Routledge, 2010.",
 "Porter, Louise. Young Children's Behaviour: Guidance Approaches for Early Childhood Educators. 4th ed., Allen & Unwin, 2016.",
 "Smith, Melissa H., and Jessica R. Berman. \"What Is Rheumatoid Arthritis?\" JAMA, vol. 327, no. 12, 2022, p. 1194.",
]
ANN=[
 ["This guideline summary presents the American Academy of Orthopaedic Surgeons' recommendations for managing knee osteoarthritis without joint replacement. The authors grade each intervention by strength of evidence and conclude that supervised exercise, weight loss and patient education should form the foundation of care, while several popular injections lack convincing support.",
  "The source is highly credible because it was produced by a professional body through a systematic review process. I will use it to justify the conservative management plan in my case study, particularly the decision to postpone imaging until the exercise programme has been tried."],
 ["The authors update the European recommendations for non-pharmacological management of hip and knee osteoarthritis. They argue that exercise, education and weight management should be offered to every patient, and they emphasise shared decision making and regular review of goals.",
  "Although the recommendations are thorough, they were developed mainly for European health systems, so some service models may not transfer directly to primary care in other countries. Nevertheless, the article strengthens my argument that education must accompany every exercise prescription."],
 ["Porter explains how educators can guide young children's behaviour by meeting their needs rather than controlling them. She contrasts authoritarian discipline with guidance approaches and shows how communication, listening and self-regulation support lasting change in children's behaviour.",
  "This book is useful for my reflection because it gave me language to analyse the trampoline incident I observed. Its limitation is that it is written for early childhood settings, so I must be careful when applying its ideas to older learners."],
 ["This fact sheet summarises the global burden of musculoskeletal conditions and explains why they are the leading cause of disability worldwide. It highlights low back pain and osteoarthritis as the largest contributors and calls for rehabilitation to be integrated into primary health care.",
  "The source is authoritative but brief, so I will use it only to establish the scale of the problem in my introduction rather than to support specific clinical decisions."],
 ["The authors give a concise patient-oriented overview of rheumatoid arthritis, describing its symptoms, diagnosis and treatment options. They stress that early treatment with disease-modifying drugs prevents joint damage and improves long-term outcomes.",
  "Because it is written for patients, the article is easy to understand but lacks detailed evidence. I will use it to explain the condition clearly in my patient education section, supported by more technical sources."],
]
specs=[]
def make(name, cites, heading="Annotated Bibliography", title_only=False, ann_indent=False, hanging=True, one_para=False,
         sub_headings=False, intro=True, refs_after=False, numbered=False, blank_between=False, double=False):
    d=Document()
    if title_only:
        p=d.add_paragraph(); r=p.add_run(heading); r.bold=True; p.alignment=WD_ALIGN_PARAGRAPH.CENTER
    else:
        d.add_heading("Introduction",1) if intro else None
        if intro:
            d.add_paragraph("This annotated bibliography evaluates sources that informed my case study on the conservative management of knee osteoarthritis, with attention to their credibility, relevance and limitations for practice in primary care settings.")
        d.add_heading(heading,1)
    keep=[]; ents=[]
    for i,c in enumerate(cites):
        if numbered: c=f"{i+1}. {c}"
        p=d.add_paragraph(c); pf=p.paragraph_format
        if hanging: pf.left_indent=Inches(0.5); pf.first_line_indent=Inches(-0.5)
        if double: pf.line_spacing=2.0
        ents.append(c[:28])
        paras=ANN[i%len(ANN)]
        if one_para: paras=[" ".join(paras)]
        for k,a in enumerate(paras):
            if sub_headings:
                h=d.add_paragraph(); h.add_run(["Summary","Evaluation"][k%2]).bold=True
            q=d.add_paragraph(a); qf=q.paragraph_format
            if ann_indent: qf.left_indent=Inches(0.5)
            if double: qf.line_spacing=2.0
            keep.append(a[:55])
        if blank_between: d.add_paragraph("")
    if refs_after:
        d.add_heading("References",1)
        for c in CITES_APA[:3]:
            p=d.add_paragraph(c); p.paragraph_format.left_indent=Inches(0.5); p.paragraph_format.first_line_indent=Inches(-0.5)
    d.save(os.path.join(OUT,name+".docx"))
    specs.append({"name":name,"entries":ents,"keep":keep})
make("ann_apa_standard", CITES_APA)
make("ann_apa_indented_annotations", CITES_APA, ann_indent=True)
make("ann_apa_single_paragraph", CITES_APA, one_para=True)
make("ann_apa_no_hanging", CITES_APA, hanging=False)
make("ann_apa_title_only", CITES_APA, title_only=True, intro=False)
make("ann_apa_subheadings", CITES_APA, sub_headings=True)
make("ann_apa_double_spaced", CITES_APA, double=True)
make("ann_apa_numbered", CITES_APA, numbered=True, hanging=False)
make("ann_apa_blank_between", CITES_APA, blank_between=True)
make("ann_mla", CITES_MLA)
make("ann_mla_works_cited_heading", CITES_MLA, heading="Works Cited")
make("ann_heading_references", CITES_APA, heading="References")
make("ann_then_references", CITES_APA[:3], refs_after=True)
json.dump(specs,open(os.path.join(OUT,"..","specs.json"),"w"),indent=1); print(len(specs))
