(() => {
  "use strict";
  const pdfButton = document.getElementById("vdPdf"),
    status = document.getElementById("vdStatus"),
    sheet = document.getElementById("vdSheet");
  const english = document.documentElement.lang === "en";
  document
    .getElementById("vdPrint")
    .addEventListener("click", () => window.print());
  const loading = new Map();
  function script(src) {
    if (loading.has(src)) return loading.get(src);
    const p = new Promise((resolve, reject) => {
      const tag = document.createElement("script");
      tag.src = src;
      tag.onload = resolve;
      tag.onerror = () => {
        tag.remove();
        loading.delete(src);
        reject(new Error("PDF library unavailable"));
      };
      document.head.appendChild(tag);
    });
    loading.set(src, p);
    return p;
  }
  pdfButton.addEventListener("click", async () => {
    const originalMinHeight = sheet.style.minHeight;
    pdfButton.disabled = true;
    status.textContent = english ? "Preparing PDF…" : "جارٍ تجهيز PDF…";
    try {
      if (!window.html2canvas)
        await script("/assets/vendor/html2canvas.min.js");
      if (!window.jspdf) await script("/assets/vendor/jspdf.umd.min.js");
      await document.fonts.ready;
      await Promise.all(
        [...sheet.querySelectorAll("img")].map((img) => img.decode()),
      );
      sheet.style.minHeight = "0";
      const canvas = await window.html2canvas(sheet, {
        scale: 1.5,
        backgroundColor: "#ffffff",
        useCORS: false,
        allowTaint: false,
        logging: false,
      });
      const pdf = new window.jspdf.jsPDF({
        unit: "mm",
        format: "a4",
        orientation: "portrait",
      });
      const box = sheet.getBoundingClientRect(),
        scale = canvas.height / sheet.offsetHeight,
        mm = canvas.width / 210,
        pageHeight = Math.floor(277 * mm);
      const boundaries = [
        ...sheet.querySelectorAll("tr,.vd-block,.vd-field,h2"),
      ]
        .flatMap((el) => {
          const r = el.getBoundingClientRect();
          return [(r.top - box.top) * scale, (r.bottom - box.top) * scale];
        })
        .filter((y) => y > 0 && y < canvas.height)
        .sort((a, b) => a - b);
      let offset = 0,
        page = 0;
      while (offset < canvas.height) {
        let end = Math.min(offset + pageHeight, canvas.height);
        if (end < canvas.height) {
          const points = boundaries.filter(
            (y) => y > offset + pageHeight * 0.45 && y <= end,
          );
          if (points.length) end = Math.floor(points.at(-1));
        }
        const height = Math.max(1, Math.floor(end - offset)),
          part = document.createElement("canvas");
        part.width = canvas.width;
        part.height = height;
        part
          .getContext("2d")
          .drawImage(
            canvas,
            0,
            offset,
            canvas.width,
            height,
            0,
            0,
            canvas.width,
            height,
          );
        if (page++) pdf.addPage();
        pdf.addImage(
          part.toDataURL("image/jpeg", 0.94),
          "JPEG",
          0,
          10,
          210,
          height / mm,
        );
        pdf.setFontSize(8);
        pdf.text(document.body.dataset.filename + " | " + page, 10, 292);
        offset += height;
      }
      pdf.save(document.body.dataset.filename + ".pdf");
      status.textContent = english ? "PDF downloaded" : "تم تنزيل PDF";
    } catch {
      status.textContent = english
        ? "PDF could not be generated. You can use Print."
        : "تعذر إنشاء PDF. يمكنك استخدام زر الطباعة.";
    } finally {
      sheet.style.minHeight = originalMinHeight;
      pdfButton.disabled = false;
    }
  });
})();
