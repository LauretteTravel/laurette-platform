export const PROGRAM_INQUIRY_SCHEMA = `
CREATE TABLE program_inquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  program_id INTEGER REFERENCES programs(id) ON DELETE SET NULL,
  program_title TEXT NOT NULL,
  current_hotel TEXT NOT NULL,
  inquiry_type TEXT NOT NULL CHECK(inquiry_type IN ('alternative_hotel','availability','group_quote')),
  requested_hotel_notes TEXT NOT NULL DEFAULT '',
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  preferred_branch TEXT CHECK(preferred_branch IN ('amman','irbid')),
  status TEXT NOT NULL DEFAULT 'جديد' CHECK(status IN ('جديد','تم التواصل','تم الحجز','ملغي')),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_program_inquiries_status ON program_inquiries(status,id DESC);
CREATE INDEX idx_program_inquiries_branch ON program_inquiries(preferred_branch,id DESC);
`;
