"""Bounded, local DOCX text/table extraction. Never extracts ZIP paths or resolves URLs."""
import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

try:
    import resource
    resource.setrlimit(resource.RLIMIT_AS, (192 * 1024 * 1024, 192 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_CPU, (5, 5))
except ImportError:
    pass

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def extract(raw):
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        files = z.infolist()
        if len(files) > 200 or len({f.filename for f in files}) != len(files):
            raise ValueError("ZIP entries")
        total = 0
        for f in files:
            name = f.filename
            if name.startswith(("/", "\\")) or ".." in name.replace("\\", "/").split("/") or "\\" in name:
                raise ValueError("ZIP path")
            total += f.file_size
            if f.flag_bits & 1 or f.file_size > 4 * 1024 * 1024 or f.file_size > max(1, f.compress_size) * 100:
                raise ValueError("ZIP expansion")
            if re.search(r"vbaproject|activex|embeddings/|\.bin$", name, re.I):
                raise ValueError("Active content")
            if name.endswith((".xml", ".rels")):
                data = z.read(f)
                # UTF-16 and entity/DTD declarations are not accepted in this limited importer.
                if b"\x00" in data or re.search(br"<!\s*(DOCTYPE|ENTITY)", data, re.I):
                    raise ValueError("XML declaration")
                if name.endswith(".rels"):
                    rels = ET.fromstring(data)
                    if any(r.attrib.get("TargetMode", "").lower() == "external" for r in rels.iter()):
                        raise ValueError("External relationship")
        if total > 10 * 1024 * 1024:
            raise ValueError("ZIP total")
        if "[Content_Types].xml" not in z.namelist() or "word/document.xml" not in z.namelist():
            raise ValueError("Not DOCX")
        root = ET.fromstring(z.read("word/document.xml"))
        body = root.find(W + "body")
        if body is None:
            raise ValueError("No document body")
        if any(e.tag in (W + "object", W + "altChunk") for e in root.iter()):
            raise ValueError("Embedded content")
        def paragraph(p):
            return "".join(e.text or "" if e.tag == W + "t" else "\t" if e.tag == W + "tab" else "\n" if e.tag == W + "br" else "" for e in p.iter())
        lines = []
        for child in body:
            if child.tag == W + "p":
                lines.append(paragraph(child))
            elif child.tag == W + "tbl":
                for row in child.findall(W + "tr"):
                    lines.append("\t|\t".join(" / ".join(paragraph(p) for p in cell.findall(W + "p")) for cell in row.findall(W + "tc")))
        out = "\n".join(lines)
        if len(out.encode("utf-8")) > 512 * 1024:
            raise ValueError("Text limit")
        return out


if __name__ == "__main__":
    try:
        raw = sys.stdin.buffer.read(5 * 1024 * 1024 + 1)
        if len(raw) > 5 * 1024 * 1024:
            raise ValueError("Input limit")
        sys.stdout.buffer.write(extract(raw).encode("utf-8"))
    except Exception:
        sys.exit(2)
