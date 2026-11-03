# Slide decks (PPTX) and Word lists whose reference entries carry bullets:
# references spread over several slides with a repeated "References" title,
# Harvard years without parentheses ("Choo, H.J., 2025."), content slides
# after the references, and bulleted Word bibliographies.
import json, sys, os
from pptx import Presentation
from pptx.util import Inches, Pt
from docx import Document
sys.argv=[sys.argv[0], sys.argv[1]]
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'generate-corpus.py')).read().split("specs=[]")[0])
OUT=sys.argv[1]; specs=[]
HARV=[
 "Choo, H.J., 2025. An Analysis of Samsung Electronics’ success myths from the perspective of dynamic capabilities. In Strategic Management and Innovation Strategies (pp. 51-78). Singapore: Springer Nature Singapore.",
 "Diamond, L., Ellis, J.O. and Schell, O. eds., 2023. Silicon triangle: the United States, Taiwan, China, and global semiconductor security. Hoover Institution Press.",
 "Glowik, M., 2016. Market entry strategies: Internationalization theories, concepts and cases of Asian high-technology firms. Walter de Gruyter GmbH & Co KG.",
 "Hayashi, T. and Sakamoto, Y., 2025. Strategic Management and Innovation Strategies. Springer.",
 "Jung, S.C., 2014. The analysis of strategic management of samsung electronics company through the generic value chain model. International Journal of Software Engineering and Its Applications, 8(12), pp.133-142.",
 "Lee, J. and Slater, J., 2007. Dynamic capabilities, entrepreneurial rent-seeking and the investment development path: The case of Samsung. Journal of International Management, 13(3), pp.241-257.",
 "Lawler III, E.E. and Worley, C.G., 2011. Built to change: How to achieve sustained organizational effectiveness. John Wiley & Sons.",
 "Ruan, S., 2020, April. Research on strategic cost management of enterprises based on Porter’s value chain model. In Journal of Physics: conference series (Vol. 1533, No. 2, p. 022056). IOP Publishing.",
 "Song, J., Lee, K. and Khanna, T., 2016. Dynamic capabilities at Samsung: Optimizing internal co-opetition. California Management Review, 58(4), pp.118-140.",
 "Teece, D.J., 2009. Dynamic capabilities and strategic management: Organizing for innovation and growth. Oxford University Press.",
 "Can, E. S. G. (2023). Global Value Chain Resilience.",
 "Yu, S., 1998. The growth pattern of Samsung electronics: a strategy perspective. International Studies of Management & Organization, 28(4), pp.57-72.",
]
CONTENT=[("Introduction","Samsung grew from a trading company into a global technology leader by investing early in memory chips and displays, and by accepting short-term losses to win long-term scale."),
         ("Disruptive Innovation","The firm repeatedly entered markets from the low end, improved quality quickly, and then moved upmarket, which allowed it to challenge established Japanese competitors in televisions and phones."),
         ("Conclusion","Samsung shows that disruptive innovation can come from a large incumbent when leadership protects new business units from the pressures of the core business.")]
AFTER_SLIDE=("Questions and Discussion","Thank you for listening. The discussion will focus on whether Samsung can repeat this pattern in foldable devices and artificial intelligence chips.")
def deck(name, per_slide=5, bullet="• ", after=False, title_each=True, expectReview=False):
    prs=Presentation(); prs.slide_width=Inches(13.33); prs.slide_height=Inches(7.5)
    lay=prs.slide_layouts[1]
    for t,body_text in CONTENT:
        s=prs.slides.add_slide(lay); s.shapes.title.text=t; s.placeholders[1].text_frame.text=body_text
    for k in range(0,len(HARV),per_slide):
        s=prs.slides.add_slide(lay); s.shapes.title.text="References" if (title_each or k==0) else "References (continued)"
        tf=s.placeholders[1].text_frame; tf.clear()
        for j,e in enumerate(HARV[k:k+per_slide]):
            p=tf.paragraphs[0] if j==0 else tf.add_paragraph(); p.text=bullet+e; p.font.size=Pt(14)
    keepAfter=None
    if after:
        s=prs.slides.add_slide(lay); s.shapes.title.text=AFTER_SLIDE[0]; s.placeholders[1].text_frame.text=AFTER_SLIDE[1]; keepAfter=AFTER_SLIDE[1][:50]
    path=os.path.join(OUT,"docx",name+".pptx"); prs.save(path)
    specs.append({"name":name,"file":name+".pptx","style":"harvard_bullets","heading":"References","after":"slide" if after else "none",
      "entries":[e[:28] for e in HARV],"keepBefore":CONTENT[0][1][:50],"keepAfter":keepAfter,"secondList":False,"expectReview":expectReview,"noRefs":False})
deck("sl_harvard_bullets_3slides")
deck("sl_harvard_bullets_2slides_continued", per_slide=6, title_each=False)
deck("sl_harvard_bullets_after_questions", after=True)
deck("sl_harvard_dash_bullets", bullet="- ")
deck("sl_harvard_square_bullets", bullet="▪ ")
def wordlist(name, bullet, style=None):
    d=Document(); body(d); h=d.add_paragraph(); h.add_run("Reference List").bold=True
    for e in HARV:
        d.add_paragraph(bullet+e if bullet else e, style=style)
    d.save(os.path.join(OUT,"docx",name+".docx"))
    specs.append({"name":name,"file":name+".docx","style":"harvard_bullets","heading":"Reference List","after":"none",
      "entries":[e[:28] for e in HARV],"keepBefore":BODY[0][:60],"keepAfter":None,"secondList":False,"expectReview":False,"noRefs":False})
wordlist("wl_harvard_typed_bullets", "• ")
wordlist("wl_harvard_word_bullet_style", None, style="List Bullet")
json.dump(specs,open(os.path.join(OUT,"specs.json"),"w"),indent=1); print(len(specs))
