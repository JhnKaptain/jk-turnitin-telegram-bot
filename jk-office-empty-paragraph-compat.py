#!/usr/bin/env python3
"""Conversion-copy only: restore missing text size in consecutive blank WPS paragraphs.
Never alters the source file, text, page breaks, figures, or document metadata.
"""
import json
import os
import sys
import zipfile
from lxml import etree

W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
W = '{' + W_NS + '}'
NS = {'w': W_NS}

def is_blank(p):
    return (len(p) == 1 and p[0].tag == W + 'pPr' and
            not p.xpath('.//w:t | .//w:drawing | .//w:pict | .//w:object | .//w:br | .//w:fldChar | .//w:instrText', namespaces=NS))

def explicit_size(p):
    props = p.find(W + 'pPr')
    candidates = [props.find(W + 'rPr')] if props is not None else []
    candidates += [r.find(W + 'rPr') for r in p.findall(W + 'r')]
    for rp in candidates:
        if rp is None:
            continue
        sz = rp.find(W + 'sz')
        if sz is not None and (sz.get(W + 'val') or '').isdigit():
            return int(sz.get(W + 'val'))
    return None

def repair_document(data):
    # Only known unsupported WPS-style font-family names are eligible.
    if b'Arial Regular' not in data:
        return data, 0
    doc = etree.fromstring(data)
    paras = doc.xpath('//w:body/w:p', namespaces=NS)
    fixed = 0
    i = 0
    while i < len(paras):
        if not is_blank(paras[i]):
            i += 1
            continue
        j = i
        while j < len(paras) and is_blank(paras[j]):
            j += 1
        if j-i >= 2 and i > 0:
            size = explicit_size(paras[i-1])
            if size is not None and 16 <= size <= 36:
                for p in paras[i:j]:
                    pr = p.find(W + 'pPr')
                    rp = pr.find(W + 'rPr')
                    sp = pr.find(W + 'spacing')
                    if rp is None or sp is None or sp.get(W + 'lineRule') != 'auto' or sp.get(W + 'line') != '480':
                        continue
                    if rp.find(W + 'sz') is not None or rp.find(W + 'szCs') is not None:
                        continue
                    lang = rp.find(W + 'lang')
                    at = list(rp).index(lang) if lang is not None else len(rp)
                    for offset, tag in enumerate(('sz', 'szCs')):
                        element = etree.Element(W + tag)
                        element.set(W + 'val', str(size))
                        rp.insert(at + offset, element)
                    fixed += 1
        i = j
    if not fixed:
        return data, 0
    return etree.tostring(doc, encoding='UTF-8', xml_declaration=True, standalone=True), fixed

def main():
    if len(sys.argv) != 3:
        raise ValueError('Usage: script.py source.docx temporary-copy.docx')
    src, dst = sys.argv[1:]
    if os.path.realpath(src) == os.path.realpath(dst) or os.path.exists(dst):
        raise ValueError('Never overwrite an existing or submitted file')
    changed = 0
    with zipfile.ZipFile(src, 'r') as archive, zipfile.ZipFile(dst, 'w') as output:
        for entry in archive.infolist():
            content = archive.read(entry.filename)
            if entry.filename == 'word/document.xml':
                content, changed = repair_document(content)
            output.writestr(entry, content)
    print(json.dumps({'normalized_blank_paragraphs': changed}))

if __name__ == '__main__':
    main()
