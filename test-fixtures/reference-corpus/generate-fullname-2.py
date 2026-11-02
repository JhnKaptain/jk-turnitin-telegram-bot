import json, sys, os
from docx import Document
from docx.shared import Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH
sys.argv=[sys.argv[0], sys.argv[1]]
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'generate-corpus.py')).read().split("specs=[]")[0])
OUT=sys.argv[1]; specs=[]
HARV_FULL=[
 "Al Halbusi, Hussam, Al-Sulaiti, Khalid Ibrahim and Alalwan, Ali Abdallah (2025) 'AI capability and green innovation impact on sustainable performance: moderating role of big data and knowledge management', Technological Forecasting and Social Change, 210, p. 123897. doi:10.1016/j.techfore.2024.123897.",
 "Barney, Jay (1991) 'Firm resources and sustained competitive advantage', Journal of Management, 17(1), pp. 99–120.",
 "United Nations Environment Programme Finance Initiative (2023) Principles for Responsible Banking: guidance document. Geneva: UNEP FI. Available at: https://www.unepfi.org/banking/ (Accessed: 12 May 2025).",
 "Chen, Pengyu and Chen, Qian Ying (2025) 'Two birds with one stone: can green finance drive the circular economy?', Humanities and Social Sciences Communications, 12(1), pp. 1–14.",
 "Porter, Michael Eugene and Kramer, Mark Robert (2011) 'Creating shared value', Harvard Business Review, 89(1/2), pp. 62–77.",
]
APA_SENTENCE_TITLES=[
 "Okafor, Chinedu Emmanuel, & Mensah, Abena Serwaa. (2024). The banks that report more are the banks that are trusted more: Evidence from West African lenders and what this means for regulators. Journal of Banking Regulation, 25 (3), 301–322. https://doi.org/10.1057/s41261-024-00230-1",
 "Nakamura, Hiroshi, Tanaka, Yuki, & Sato, Kenji. (2023). This study shows that disclosure quality is higher when boards are independent and when the auditor is one of the large firms. Asian Review of Accounting, 31 (4), 512–534. https://doi.org/10.1108/ARA-02-2023-0041",
 "Fernández-García, María José, & López, Juan Carlos. (2022). In emerging markets, green bonds are priced differently than conventional bonds because investors value the certification. Sustainability, 14 (9), 5120. https://doi.org/10.3390/su14095120",
 "Reuters. (2024, March 3). Saudi Arabia's PIF prices its third green bond as demand from global investors grows. Reuters. https://www.reuters.com/markets/",
 "Saudi Central Bank. (n.d.). Sustainable finance framework. Retrieved May 12, 2025, from https://www.sama.gov.sa/en-US/",
 "Kumar, Anil. (2021). Green finance: Concepts and practice (2nd ed.). Palgrave Macmillan.",
]
NUMBERED=[ "1. "+e for e in APA_SENTENCE_TITLES[:3]]+[ str(i+4)+". "+e for i,e in enumerate(APA_SENTENCE_TITLES[3:])]
TAIL="The findings presented above should be interpreted with care, because the sample covers only listed firms and the observation period ends before the most recent regulatory changes were introduced in the region (Barney, 1991, pp. 99–120)."
def build(name, entries, fmt="none", spacing=None, blank=False, header=None, after=None, heading="References", style="x", expectReview=False, keepAfter=None, between=None, justify=False):
    d=Document(); body(d)
    if header: d.sections[0].header.paragraphs[0].text=header; add_page_field(d.sections[0].header.paragraphs[0])
    h=d.add_paragraph(); r=h.add_run(heading); r.bold=True
    for k,e in enumerate(entries):
        if between is not None and k==between:
            if blank: d.add_paragraph("")
            d.add_paragraph("Reflecting on these sources, I found that the most useful studies were those that compared banks across several countries, because they showed how regulation shapes disclosure in practice.")
            if blank: d.add_paragraph("")
        p=d.add_paragraph(e); pf=p.paragraph_format
        if fmt=="hanging": pf.left_indent=Inches(0.5); pf.first_line_indent=Inches(-0.5)
        if spacing: pf.line_spacing=spacing
        if justify: p.alignment=WD_ALIGN_PARAGRAPH.JUSTIFY
        if blank and k<len(entries)-1: d.add_paragraph("")
    if after=="tail_with_citation":
        d.add_paragraph(TAIL); keepAfter=TAIL[:60]
    elif after=="figure":
        d.add_paragraph("Figure 1. Conceptual model of the study"); d.add_paragraph(AFTER_PROSE); keepAfter=AFTER_PROSE[:60]
    d.save(os.path.join(OUT,"docx",name+".docx"))
    specs.append({"name":name,"style":style,"heading":heading,"after":after or "none","entries":[e[:28] for e in entries],
      "keepBefore":BODY[0][:60],"keepAfter":keepAfter,"secondList":False,"expectReview":expectReview,"noRefs":False})
build("fn2_harvard_fullname", HARV_FULL, fmt="hanging", heading="Reference List")
build("fn2_harvard_fullname_noindent_justified", HARV_FULL, justify=True, heading="Reference List")
build("fn2_sentence_titles", APA_SENTENCE_TITLES)
build("fn2_sentence_titles_hanging_double", APA_SENTENCE_TITLES, fmt="hanging", spacing=2.0)
build("fn2_blank_between", APA_SENTENCE_TITLES+HARV_FULL[:2], blank=True)
build("fn2_numbered_apa", NUMBERED)
build("fn2_running_head", APA_SENTENCE_TITLES+HARV_FULL, header="Running head: GREEN FINANCE AND BANK PERFORMANCE ")
build("fn2_no_doi_last_then_prose", APA_SENTENCE_TITLES[:3]+["ClarityAI. (2025). Sustainable Finance Regulatory Outlook 2025."], after="tail_with_citation")
build("fn2_after_figure", APA_SENTENCE_TITLES, fmt="hanging", after="figure")
build("neg_fn2_prose_between_blank", APA_SENTENCE_TITLES, between=3, blank=True, expectReview=True)
json.dump(specs,open(os.path.join(OUT,"specs.json"),"w"),indent=1); print(len(specs))
