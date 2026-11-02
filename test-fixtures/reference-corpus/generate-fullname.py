# Full-given-name APA (and MLA/Chicago) lists with long sentence-like titles,
# author lists that push the year to the next line, books, chapters,
# organization authors, ahead-of-print, page numbers and text after the list.
import json, sys, os
from docx import Document
from docx.shared import Inches, Pt
from docx.enum.text import WD_ALIGN_PARAGRAPH
sys.argv=[sys.argv[0], sys.argv[1]]
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'generate-corpus.py')).read().split("specs=[]")[0])
OUT=sys.argv[1]; specs=[]
FULL=[
 "Al Halbusi, Hussam, Al-Sulaiti, Khalid Ibrahim, Alalwan, Ali Abdallah, & Al-Busaidi, Adil S. (2025). AI capability and green innovation impact on sustainable performance: Moderating role of big data and knowledge management. Technological Forecasting and Social Change, 210, 123897. https://doi.org/10.1016/j.techfore.2024.123897",
 "Alshdaifat, Sajead Mowafaq, Aziz, Noor Hidayah Ab, Al Qadi, Fatima, & Alhadab, Yahia. (2024). Driving Sustainability Forward: Do Fintech and Digital Transformation Matter? (pp. 223–229). Springer, Singapore. https://doi.org/10.1007/978-981-97-2981-4_16",
 "Bag, Surajit. (2024). From resources to sustainability: a practice-based view of net zero economy implementation in small and medium business-to-business firms. Benchmarking, 31 (6), 1876–1894. https://doi.org/10.1108/BIJ-01-2023-0056",
 "Barney, J. (1991). Firm resources and sustained competitive advantage. Journal of Management, 17 (1), 99–120.",
 "ClarityAI. (2025). Sustainable Finance Regulatory Outlook 2025.",
 "Dimaggio, Paul J., & Powell, Walter W. (1983). The Iron Cage Revisited: Institutional Isomorphism and Collective Rationality in Organizational Fields. American Sociological Review, 48 (2), 147–160.",
 "Hair, Joseph F., Risher, Jeffrey J., Sarstedt, Marko, & Ringle, Christian M. (2019). When to use and how to report the results of PLS-SEM. In European Business Review (Vol. 31, Issue 1, pp. 2–24). Emerald Group Publishing Ltd. https://doi.org/10.1108/EBR-11-2018-0203",
 "Hair, Joseph F., Singh, Sandeep, Kaur, Rajinder, & Dana, Leo Paul. (2022). A Primer on Partial Least Squares Structural Equation Modeling (PLS-SEM). SAGE Publication, 1–352.",
 "Hidayat-ur-Rehman, Imdadullah. (2026). Driving sustainable banking performance: the roles of digital transformation, FinTech adoption, and financial inclusion under regulatory environment moderation. China Finance Review International, ahead-of-print, 1–27. https://doi.org/10.1108/CFRI-03-2025-0170",
 "Van der Merwe, Johannes Petrus, de Villiers, Charl, & Maroun, Warren. (2023). This is why firms that are larger are more likely to adopt integrated reporting and what it means for investors. Journal of Accounting Research, 61 (2), 455–489.",
 "Henseler, Jörg, Ringle, Christian M., & Sarstedt, Marko. (2015). A new criterion for assessing discriminant validity in variance-based structural equation modeling. Journal of the Academy of Marketing Science, 43 (1), 115–135. https://doi.org/10.1007/s11747-014-0403-8",
 "World Bank Group. (2024). State and Trends of Carbon Pricing 2024. World Bank. https://openknowledge.worldbank.org/handle/10986/41544",
]
MLA_FULL=[
 "Waltz, Kenneth Neal. Theory of International Politics. Addison-Wesley Publishing Company, 1979.",
 "Wendt, Alexander. \"Anarchy Is What States Make of It: The Social Construction of Power Politics.\" International Organization, vol. 46, no. 2, 1992, pp. 391–425.",
 "Jervis, Robert. \"Cooperation under the Security Dilemma.\" World Politics, vol. 30, no. 2, 1978, pp. 167–214.",
 "Keohane, Robert Owen, and Joseph Samuel Nye. Power and Interdependence: World Politics in Transition. Little, Brown and Company, 1977.",
 "Fearon, James Dana. \"Rationalist Explanations for War.\" International Organization, vol. 49, no. 3, 1995, pp. 379–414.",
]
NOTE="Nonetheless, the plan has limitations that should be acknowledged, since the firm's reporting cycle may prevent regular updates and the regulator does not currently publish quarterly guidance for smaller banks."
Q2="During the second phase of the study, the analysis turned to the banking sector, where regulators have encouraged lenders to publish climate disclosures and to integrate environmental risk into their credit decisions."
def build(name, entries, fmt="none", spacing=None, justify=False, footer=False, after=None, heading="References", style="apa_full", expectReview=False, keepAfter=None, between=None):
    d=Document(); body(d)
    if footer: add_page_field(d.sections[0].footer.paragraphs[0])
    h=d.add_paragraph(); r=h.add_run(heading); r.bold=True
    for k,e in enumerate(entries):
        if between is not None and k==between:
            d.add_paragraph("In my own analysis I found that the banks which adopted digital tools earlier were also the ones that reported stronger environmental performance, which suggests that capability matters more than size.")
        p=d.add_paragraph(e); pf=p.paragraph_format
        if fmt=="hanging": pf.left_indent=Inches(0.5); pf.first_line_indent=Inches(-0.5)
        if spacing: pf.line_spacing=spacing
        if justify: p.alignment=WD_ALIGN_PARAGRAPH.JUSTIFY
    if after=="declaration":
        q=d.add_paragraph(); q.add_run("Declaration of Competing Interest").bold=True
        d.add_paragraph("The authors declare that they have no known competing financial interests or personal relationships that could have appeared to influence the work reported in this paper.")
        keepAfter="The authors declare that they have no known competing"
    elif after=="appendix":
        d.add_heading("Appendix A: Measurement Items",1); d.add_paragraph(AFTER_PROSE); keepAfter=AFTER_PROSE[:60]
    elif after=="question2":
        d.add_page_break(); d.add_paragraph("Question 2: Green Finance in Practice"); d.add_paragraph(Q2); d.add_paragraph(BODY[1]); keepAfter=Q2[:60]
    elif after=="prose":
        d.add_paragraph(NOTE); keepAfter=NOTE[:60]
    d.save(os.path.join(OUT,name+".docx"))
    specs.append({"name":name,"style":style,"heading":heading,"after":after or "none","entries":[e[:28] for e in entries],
      "keepBefore":BODY[0][:60],"keepAfter":keepAfter,"secondList":False,"expectReview":expectReview,"noRefs":False})
build("fn_apa_noindent", FULL)
build("fn_apa_hanging", FULL, fmt="hanging")
build("fn_apa_justified", FULL, justify=True)
build("fn_apa_double_spaced", FULL, spacing=2.0)
build("fn_apa_double_hanging_justified", FULL, fmt="hanging", spacing=2.0, justify=True)
build("fn_apa_footer_pages", FULL+FULL[:6], footer=True)
build("fn_apa_after_declaration", FULL, after="declaration")
build("fn_apa_after_appendix", FULL, fmt="hanging", after="appendix")
build("fn_apa_after_question2", FULL, after="question2")
build("fn_apa_after_unheaded_prose", FULL, after="prose")
build("fn_mla_fullname", MLA_FULL, heading="Works Cited", style="mla_full")
build("fn_mla_after_question2", MLA_FULL, heading="Works Cited", style="mla_full", after="question2", fmt="hanging")
build("neg_fn_prose_between_entries", FULL, between=5, expectReview=True)
json.dump(specs,open(os.path.join(OUT,"specs.json"),"w"),indent=1); print(len(specs))
