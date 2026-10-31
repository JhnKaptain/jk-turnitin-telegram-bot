import json, sys, os
from docx import Document
from docx.shared import Inches
sys.argv=[sys.argv[0], sys.argv[1]]
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'gen.py')).read().split("specs=[]")[0])
OUT=sys.argv[1]; specs=[]
STARTS={"patients":"Patients who attended the follow-up clinic reported that the written exercise plan helped them remain consistent, and several described noticeable improvements in stairs and walking distance within six weeks.",
        "prevention":"Prevention remains the most important message of this case, because early weight management and strengthening exercise reduce the likelihood that mild symptoms progress to disabling joint damage in later life.",
        "nonetheless":"Nonetheless, the plan has limitations that should be acknowledged, since the patient's work schedule may prevent regular attendance and the clinic does not currently offer evening physiotherapy sessions for working adults.",
        "issues":"Issues of access and cost were raised repeatedly during the consultation, and they should be addressed through community exercise programmes that are free at the point of use and located near public transport.",
        "volunteers":"Volunteers from the local walking group offered to accompany the patient twice a week, which addressed her concern about exercising alone and gave her a social reason to keep attending."}
for k,para in STARTS.items():
    d=Document(); body(d)
    refs(d, APA, fmt="none")            # no hanging indent: the hardest case
    d.add_paragraph(para)
    d.save(os.path.join(OUT,"neg_prose_after_refs_starts_"+k+".docx"))
    specs.append({"name":"neg_prose_after_refs_starts_"+k,"style":"apa","heading":"References","after":"prose",
                  "entries":[e[:28] for e in APA],"keepBefore":BODY[0][:60],"keepAfter":para[:60],"secondList":False,"expectReview":False,"noRefs":False})
json.dump(specs,open(os.path.join(OUT,"specs.json"),"w"),indent=1); print(len(specs))
