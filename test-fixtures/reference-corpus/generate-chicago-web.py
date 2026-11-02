# Chicago / MLA bibliographies dominated by web sources, organisation authors
# with "n.d.", quoted titles first, photographs, laws, wrapped long URLs with
# %, & and = characters, "Accessed ..." dates and publisher descriptions.
import json, sys, os
from docx import Document
from docx.shared import Inches
sys.argv=[sys.argv[0], sys.argv[1]]
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'generate-corpus.py')).read().split("specs=[]")[0])
OUT=sys.argv[1]; specs=[]
WEB=[
 "Anthony, Amanda Koontz. “Racialized Authentication: Constructing Representations of the Florida Highwaymen.” The Sociological Quarterly 53, no. 3 (2012): 394–421. https://doi.org/10.1111/j.1533-8525.2012.01236.x.",
 "Cincinnati Art Museum. Identity. Cincinnati Wing teacher guide. n.d. Accessed October 29, 2026. https://piction.cincinnatiartmuseum.org/piction/ump.di?e=0034398361EA95BBC836CB1004E04FC4C0EE9C1FB6F05DEE506BA56B30A82BA9&f=%5Cd1312%5Cu17813125%5CTG_Cincinnati+Wing_Identity.pdf&s=21&se=52565890&v=0.",
 "“Confrontation Between Black Demonstrators and Segregationists at a ‘White Only’ Beach.” June 25, 1964. Photograph. Library of Congress, World Digital Library. Item 2021669928. https://www.loc.gov/item/2021669928/.",
 "Florida Department of State, Division of Arts and Culture. “Alfred Hair and the Florida Highwaymen.” Accessed October 29, 2026. https://dos.fl.gov/cultural/about-us/50th-anniversary-celebration/the-talent/alfred-hair-and-the-florida-highwaymen/.",
 "Intellect. “The Making of an Artist: Desire, Courage, and Commitment.” Publisher’s description of Kristin G. Congdon’s book (2018). Accessed October 29, 2026. https://www.intellectbooks.com/the-making-of-an-artist.",
 "Museum of Florida History. “Alfred Hair.” Accessed October 29, 2026. https://museumoffloridahistory.com/explore/collections/florida-highwaymen-collection/alfred-hair/.",
 "Smithsonian American Art Museum. J. P. Ball and Robert Duncanson: An African-American Artistic Collaboration. Exhibition wall text and checklist, 2023. https://d3ec1vt3scx7rr.cloudfront.net/files/documents/2023-09/Ball%20Duncanson%20wall%20text_checklist.pdf.",
 "UBC Press. “Just Above the Water.” Distributor’s description of Kristin G. Congdon and Tina Bucuvalas’s Just Above the Water: Florida Folk Art (University Press of Mississippi, 2006). Accessed October 29, 2026. https://www.ubcpress.ca/just-above-the-water.",
 "United States. Civil Rights Act of 1964. Public Law 88-352. July 2, 1964. National Archives. https://www.archives.gov/milestone-documents/civil-rights-act.",
 "Hagood, Taylor. “Negotiating Kitsch and Race in Florida Writing and Art: Hurston, the Highwaymen, and Duval-Carrié.” In Black Hibiscus: African Americans and the Florida Imaginary, edited by John Wharton Lowe, 123–37. Jackson: University Press of Mississippi, 2024.",
]
MLA_WEB=[
 "“Alfred Hair.” Museum of Florida History, museumoffloridahistory.com/explore/collections/florida-highwaymen-collection/alfred-hair/. Accessed 29 Oct. 2026.",
 "Anthony, Amanda Koontz. “Racialized Authentication: Constructing Representations of the Florida Highwaymen.” The Sociological Quarterly, vol. 53, no. 3, 2012, pp. 394–421.",
 "National Park Service. “African American Outdoor Recreation.” NPS.gov, 2022, www.nps.gov/subjects/nationalhistoriclandmarks/african-american-outdoor-recreation.htm.",
 "Tanzi, Ron. “Art Criticism.” Bellevue College, 2004, www2.bellevuecollege.edu/artshum/materials/art/Tanzi/fall04/105/ARTcriticismfall04.htm. Accessed 29 Oct. 2026.",
]
TAIL="Looking back at the research process, the most persuasive sources were the oral histories, because they showed how the painters themselves understood the risks of selling art along the highway during segregation."
def build(name, entries, heading="BIBLIOGRAPHY", fmt="hanging", spacing=None, after=None, expectReview=False, between=None):
    d=Document(); body(d); keepAfter=None
    h=d.add_paragraph(); h.add_run(heading).bold=True
    for k,e in enumerate(entries):
        if between is not None and k==between: d.add_paragraph(TAIL)
        p=d.add_paragraph(e); pf=p.paragraph_format
        if fmt=="hanging": pf.left_indent=Inches(0.5); pf.first_line_indent=Inches(-0.5)
        if spacing: pf.line_spacing=spacing
    if after=="appendix": d.add_heading("Appendix A: Image List",1); d.add_paragraph(AFTER_PROSE); keepAfter=AFTER_PROSE[:60]
    if after=="prose": d.add_paragraph(TAIL); keepAfter=TAIL[:60]
    d.save(os.path.join(OUT,"docx",name+".docx"))
    specs.append({"name":name,"style":"chicago_web","heading":heading,"after":after or "none","entries":[e[:28] for e in entries],
      "keepBefore":BODY[0][:60],"keepAfter":keepAfter,"secondList":False,"expectReview":expectReview,"noRefs":False})
build("cw_chicago_web_hanging", WEB)
build("cw_chicago_web_noindent", WEB, fmt="none")
build("cw_chicago_web_double", WEB, spacing=2.0)
build("cw_chicago_web_after_appendix", WEB, after="appendix")
build("cw_chicago_web_after_prose", WEB, fmt="none", after="prose")
build("cw_mla_web", MLA_WEB, heading="Works Cited")
build("cw_mla_web_noindent_after_prose", MLA_WEB, heading="Works Cited", fmt="none", after="prose")
build("neg_cw_prose_between_web_entries", WEB, between=5, expectReview=True)
json.dump(specs,open(os.path.join(OUT,"specs.json"),"w"),indent=1); print(len(specs))
