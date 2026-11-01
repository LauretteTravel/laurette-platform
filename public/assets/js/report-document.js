(() => {
  "use strict";
  const button = document.getElementById("rdPdf"),
    status = document.getElementById("rdStatus"),
    sheet = document.getElementById("rdSheet");
  document.getElementById("rdPrint").onclick = () => window.print();
  const script = (src) =>
    new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => {
        s.remove();
        reject(new Error("تعذر تحميل مكتبة التصدير المحلية"));
      };
      document.head.append(s);
    });
  button.onclick = async () => {
    button.disabled = true;
    status.textContent = "جارٍ إعداد صفحات PDF…";
    try {
      if (!window.html2canvas)
        await script("/assets/vendor/html2canvas.min.js");
      if (!window.jspdf) await script("/assets/vendor/jspdf.umd.min.js");
      await document.fonts.ready;
      await Promise.all(
        [...sheet.querySelectorAll("img")].map((img) => img.decode()),
      );
      const pdf = new window.jspdf.jsPDF({
        unit: "mm",
        format: "a4",
        orientation: "portrait",
      });
      let y = 10,
        printed = false;
      const capture = (el) =>
        window.html2canvas(el, {
          scale: 1.5,
          backgroundColor: "#ffffff",
          useCORS: false,
          allowTaint: false,
          logging: false,
        });
      const newPage = () => {
        if (printed) pdf.addPage();
        printed = true;
        y = 10;
      };
      for (const block of [...sheet.children]) {
        // Capture bounded sections rather than one unbounded full-report canvas.
        if (block.offsetHeight > 16000)
          throw new Error(
            "أحد أقسام التقرير كبير جدًا. ضيق الفلاتر أو استخدم الطباعة لحفظ التقرير الكامل.",
          );
        const box = block.getBoundingClientRect(),
          canvas = await capture(block),
          pxPerMm = canvas.width / 190,
          scale = canvas.height / Math.max(1, block.offsetHeight);
        const points = [...block.querySelectorAll("tr,p,.rd-line")]
          .map((el) => (el.getBoundingClientRect().bottom - box.top) * scale)
          .filter((v) => v > 0 && v <= canvas.height)
          .sort((a, b) => a - b);
        const head = block.querySelector("thead"),
          table = block.querySelector("table");
        let headCanvas = null;
        const headEnd = head
            ? (head.getBoundingClientRect().bottom - box.top) * scale
            : 0,
          tableEnd = table
            ? (table.getBoundingClientRect().bottom - box.top) * scale
            : 0;
        let offset = 0;
        while (offset < canvas.height) {
          if (!printed) newPage();
          let capacity = Math.floor((280 - y) * pxPerMm);
          if (capacity < 20) {
            newPage();
            capacity = Math.floor(270 * pxPerMm);
          }
          const pageWasEmpty = y === 10;
          if (y === 10 && offset > headEnd && offset < tableEnd && head) {
            headCanvas ??= await capture(head);
            const h = (headCanvas.height / headCanvas.width) * 190;
            pdf.addImage(
              headCanvas.toDataURL("image/jpeg", 0.93),
              "JPEG",
              10,
              y,
              190,
              h,
            );
            y += h;
            capacity = Math.floor((280 - y) * pxPerMm);
          }
          let end = Math.min(canvas.height, offset + capacity);
          if (end < canvas.height) {
            const candidates = points.filter((v) => v > offset + 1 && v <= end);
            if (candidates.length) end = Math.floor(candidates.at(-1));
            else if (!pageWasEmpty) {
              newPage();
              continue;
            }
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
          pdf.addImage(
            part.toDataURL("image/jpeg", 0.93),
            "JPEG",
            10,
            y,
            190,
            height / pxPerMm,
          );
          y += height / pxPerMm;
          offset += height;
          if (offset < canvas.height) newPage();
        }
        y += 3;
      }
      const pages = pdf.getNumberOfPages();
      for (let i = 1; i <= pages; i++) {
        pdf.setPage(i);
        pdf.setFontSize(8);
        pdf.text(`${document.body.dataset.filename} | ${i}/${pages}`, 10, 292);
      }
      pdf.save(document.body.dataset.filename + ".pdf");
      status.textContent = `تم تنزيل PDF — ${pages} صفحات`;
    } catch (e) {
      status.textContent =
        e.message || "تعذر إنشاء PDF؛ يمكنك استخدام الطباعة.";
    } finally {
      button.disabled = false;
    }
  };
})();
