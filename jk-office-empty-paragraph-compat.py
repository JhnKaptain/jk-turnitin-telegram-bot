#!/usr/bin/env python3
"""Normalize WPS blank paragraph sizes in a temporary DOCX copy only.

Use byte-range XML insertions, never XML-tree reserialization, so unfamiliar
Office namespaces, markup-compatibility instructions and metadata survive.
"""
import json
import os
import re
import sys
import zipfile
from xml.etree import ElementTree as ET
from xml.parsers.expat import ParserCreate

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'


def explicit_size(paragraph):
    props = paragraph.find(W + 'pPr')
    candidates = [props.find(W + 'rPr')] if props is not None else []
    candidates += [run.find(W + 'rPr') for run in paragraph.findall(W + 'r')]
    for rp in candidates:
        if rp is not None:
            size = rp.find(W + 'sz')
            if size is not None and (size.get(W + 'val') or '').isdigit():
                return int(size.get(W + 'val'))
    return None


def blank(paragraph):
    return len(paragraph) == 1 and paragraph[0].tag == W + 'pPr'


def direct_body_ranges(data):
    """Byte offsets for direct child w:p elements, excluding table/drawing paragraphs."""
    parser = ParserCreate()
    stack = []
    ranges = []
    opened = []

    def start(name, _attributes):
        if name == 'w:p' and stack and stack[-1] == 'w:body':
            opened.append(parser.CurrentByteIndex)
        stack.append(name)

    def end(name):
        if name == 'w:p' and len(stack) > 1 and stack[-2] == 'w:body':
            at = parser.CurrentByteIndex
            close_end = data.find(b'>', at) + 1
            if close_end <= 0 or not data[at:close_end].startswith(b'</w:p>'):
                raise ValueError('Unexpected XML paragraph closing tag')
            ranges.append((opened.pop(), close_end))
        stack.pop()

    parser.StartElementHandler = start
    parser.EndElementHandler = end
    parser.Parse(data, True)
    return ranges


def repair_document(data):
    if b'Arial Regular' not in data:
        return data, 0
    root = ET.fromstring(data)
    body = root.find(W + 'body')
    if body is None:
        return data, 0
    paragraphs = body.findall(W + 'p')
    ranges = direct_body_ranges(data)
    if len(paragraphs) != len(ranges):
        raise ValueError('Paragraph byte mapping mismatch')
    edits = []
    i = 0
    while i < len(paragraphs):
        if not blank(paragraphs[i]):
            i += 1
            continue
        end = i
        while end < len(paragraphs) and blank(paragraphs[end]):
            end += 1
        if end - i >= 2 and i > 0:
            size = explicit_size(paragraphs[i - 1])
            if size is not None and 16 <= size <= 36:
                for index in range(i, end):
                    para = paragraphs[index]
                    props = para.find(W + 'pPr')
                    rp = props.find(W + 'rPr')
                    sp = props.find(W + 'spacing')
                    if (rp is None or sp is None or
                            sp.get(W + 'lineRule') != 'auto' or
                            sp.get(W + 'line') != '480' or
                            rp.find(W + 'sz') is not None or rp.find(W + 'szCs') is not None):
                        continue
                    start, stop = ranges[index]
                    segment = data[start:stop]
                    ppr_match = re.search(rb'<w:pPr\b[^>]*>(.*?)</w:pPr>', segment, re.S)
                    if not ppr_match:
                        raise ValueError('Cannot identify paragraph properties')
                    ppr = ppr_match.group(1)
                    run_match = re.search(rb'<w:rPr\b[^>]*>(.*?)</w:rPr>', ppr, re.S)
                    if not run_match:
                        raise ValueError('Cannot identify run properties')
                    inner = run_match.group(1)
                    if b'<w:sz' in inner:
                        raise ValueError('Unexpected pre-existing font size')
                    lang = re.search(rb'<w:lang\b', inner)
                    insert_position = (start + ppr_match.start(1) + run_match.start(1) +
                                       (lang.start() if lang else len(inner)))
                    addition = ('<w:sz w:val="%d"/><w:szCs w:val="%d"/>' % (size, size)).encode('ascii')
                    edits.append((insert_position, addition))
        i = end
    if not edits:
        return data, 0
    result = data
    for offset, addition in sorted(edits, reverse=True):
        result = result[:offset] + addition + result[offset:]
    ET.fromstring(result)
    return result, len(edits)


def main():
    if len(sys.argv) != 3:
        raise ValueError('Usage: script.py source.docx temporary-copy.docx')
    src, dst = sys.argv[1:]
    if os.path.realpath(src) == os.path.realpath(dst) or os.path.exists(dst):
        raise ValueError('Never overwrite an existing or submitted file')
    with zipfile.ZipFile(src, 'r') as archive:
        if 'word/document.xml' not in archive.namelist():
            raise ValueError('Missing Word document part')
        fixed_xml, changed = repair_document(archive.read('word/document.xml'))
        if not changed:
            print(json.dumps({'normalized_blank_paragraphs': 0}))
            return
        # Never change the base directory of relative external resources.
        for item in archive.namelist():
            if not item.endswith('.rels'):
                continue
            relationships = ET.fromstring(archive.read(item))
            for relationship in relationships:
                if relationship.get('TargetMode') == 'External':
                    target = relationship.get('Target', '')
                    if not re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:', target) and not target.startswith('//'):
                        raise ValueError('Relative linked content requires original document directory')
        with zipfile.ZipFile(dst, 'w') as output:
            output.comment = archive.comment
            for entry in archive.infolist():
                content = fixed_xml if entry.filename == 'word/document.xml' else archive.read(entry.filename)
                output.writestr(entry, content)
    print(json.dumps({'normalized_blank_paragraphs': changed}))


if __name__ == '__main__':
    main()
