import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const LIMIT = 512 * 1024;
function run(executable, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "ignore"],
      shell: false,
    });
    let size = 0,
      chunks = [],
      done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) {
        child.kill("SIGKILL");
        reject(error);
      } else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error("extract-timeout")), 8000);
    child.on("error", () => finish(new Error("extract-unavailable")));
    child.stdin.on("error", () => {});
    child.stdout.on("data", (b) => {
      size += b.length;
      if (size > LIMIT) finish(new Error("extract-limit"));
      else chunks.push(b);
    });
    child.on("close", (code) =>
      code === 0
        ? finish(null, Buffer.concat(chunks).toString("utf8"))
        : finish(new Error("extract-failed")),
    );
    child.stdin.end(input);
  });
}
export function sourceAnalysis(text) {
  const clean = text.replaceAll("\u0000", "").slice(0, LIMIT),
    candidates = [];
  let page = 1,
    line = 0;
  for (const part of clean.split(/(\f)|\r?\n/)) {
    if (part === undefined) continue;
    if (part === "\f") {
      page++;
      continue;
    }
    line++;
    const normalized = part
      .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
      .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
    const currencies = [
      ...new Set(
        normalized.match(
          /\b(?:JOD|USD|EUR|SAR|AED|TRY|EGP|GBP)\b|د\.?أ|دينار|دولار|ريال|درهم|يورو/gi,
        ) || [],
      ),
    ];
    const dates = normalized.match(/\d{4}-\d{2}-\d{2}/g) || [];
    if (
      currencies.length ||
      dates.length ||
      /شروط|يشمل|لا يشمل|conditions|includes|excludes/i.test(normalized)
    )
      candidates.push({
        page,
        line,
        text: part.trim(),
        amounts: normalized.match(/\d+(?:[.,]\d+)?/g) || [],
        currencies,
        dates,
        basis:
          normalized.match(
            /للفرد|للغرفة|للحجز|per\s+(?:person|room|booking)/i,
          )?.[0] || null,
        occupancy:
          normalized.match(
            /مفرد|مزدوج|ثنائي|ثلاثي|رباعي|single|double|triple|quad/i,
          )?.[0] || null,
        confidence: "unverified",
      });
    if (candidates.length >= 200) break;
  }
  return {
    status: clean.trim().length < 10 ? "failed" : "extracted",
    text: clean,
    candidates,
    warnings: [
      "الاستخراج آلي وغير متحقق؛ راجع الأصل والعملة والفرد/الغرفة والإشغال والتواريخ والشروط.",
      "لا تُطبق الاقتراحات تلقائيًا. ترتيب أعمدة PDF والجداول المعقدة قد يحتاج تصحيحًا يدويًا.",
    ],
    error:
      clean.trim().length < 10
        ? "لم يظهر نص قابل للمراجعة؛ قد يلزم OCR أو إدخال يدوي."
        : null,
  };
}
export async function extractProgramSource(bytes, kind) {
  try {
    const pdfArgs = [
      "-layout",
      "-enc",
      "UTF-8",
      "-f",
      "1",
      "-l",
      "50",
      "-",
      "-",
    ];
    const text =
      kind === "pdf"
        ? await run(
            process.platform === "linux"
              ? "prlimit"
              : process.env.PROGRAM_PDFTOTEXT || "pdftotext",
            process.platform === "linux"
              ? [
                  "--as=201326592",
                  "--cpu=5",
                  "--",
                  process.env.PROGRAM_PDFTOTEXT || "pdftotext",
                  ...pdfArgs,
                ]
              : pdfArgs,
            bytes,
          )
        : await run(
            process.env.PROGRAM_PYTHON || "python3",
            [
              fileURLToPath(
                new URL("../tools/extract-program-docx.py", import.meta.url),
              ),
            ],
            bytes,
          );
    const analysis = sourceAnalysis(text);
    return {
      ...analysis,
      warnings: [
        ...analysis.warnings,
        kind === "pdf"
          ? "تم استخراج أول 50 صفحة كحد أقصى؛ راجع اكتمال المصدر."
          : "تم استخراج متن DOCX والجداول؛ الرؤوس والتعليقات والصور ليست بيانات موثوقة مستخرجة.",
      ],
    };
  } catch {
    return {
      status: "failed",
      text: "",
      candidates: [],
      warnings: [],
      error:
        "تعذر الاستخراج الآمن؛ الأصل محفوظ للمراجعة. قد يكون الملف محميًا أو غير صالح، أو تحتاج أدوات الاستخراج إلى إعداد، أو يلزم OCR/إدخال يدوي.",
    };
  }
}
