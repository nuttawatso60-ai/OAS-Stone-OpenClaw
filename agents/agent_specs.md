# OAS Stone Engraving — Agent Specs v0.1

## ภาพรวม

ระบบใช้ agent 3 ตัวทำงานร่วมกัน ยังไม่เชื่อม Telegram / Facebook / Database ใน v0.1

---

## Claire — Customer Intake Agent

**บทบาท:** รับข้อมูลลูกค้า → แปลงเป็น job dict

**Input ที่ต้องการ:**
- ขนาดป้าย (กว้าง × สูง cm)
- ประเภทหิน (แกรนิตดำ / แกรนิตเทา / หินอ่อน / หินทราย)
- ความหนา (2 / 3 / 5 / 8 cm)
- ข้อความที่ต้องการแกะสลัก
- สีที่ต้องการ (ไม่ทา / ขาว / ดำ / แดง / ทองทาสี / ทองคำเปลว)
- ฐาน (ไม่มี / เรียบ / พรีเมี่ยม / พิเศษ)
- การติดตั้ง (ไม่ติดตั้ง / ทั่วไป / พิเศษ)
- การจัดส่ง (รับเอง / ในอำเภอ / ในจังหวัด / ต่างจังหวัด)

**Output:** JSON job object ที่ตรงกับ schema ใน `sample_jobs.json`

**ข้อจำกัด v0.1:**
- รับข้อมูลผ่านการพิมพ์เท่านั้น (CLI หรือ prompt)
- ยังไม่รับภาพ / ไฟล์แนบ
- ยังไม่เชื่อม Telegram / Line

---

## Max — Quotation Agent

**บทบาท:** รับ job dict จาก Claire → รัน pricing_engine.py → ส่งใบเสนอราคากลับ

**Input:** job dict (JSON)

**Output:**
- ใบเสนอราคาแบบ breakdown (รายการ + ราคา + รวม)
- ระบุว่าเป็น "ราคาประมาณ" เสมอ
- แนะนำให้ลูกค้ายืนยันกับร้านก่อนโอนเงิน

**Logic:**
```
load pricing_rules.json
→ calculate(job, rules)
→ format print_quote()
→ return quote string
```

**ข้อจำกัด v0.1:**
- ราคาเป็นการประมาณเบื้องต้นเท่านั้น
- ไม่รวมค่าออกแบบพิเศษ / ค่าแบบ
- ไม่รวม VAT

---

## OPS — Operations Manager Agent

**บทบาท:** ติดตามสถานะงาน / แจ้งเตือนภายใน

**ใน v0.1 ทำได้:**
- แสดงรายการ job ทั้งหมดจาก sample_jobs.json
- คำนวณราคารวมทุก job
- สรุปรายได้รวม (ประมาณ)

**ใน v0.2+ (TODO):**
- บันทึก job ลง SQLite
- เพิ่ม status: รอผลิต / กำลังผลิต / เสร็จแล้ว / ส่งแล้ว
- แจ้งเตือนผ่าน Telegram
- รายงานรายวัน / รายสัปดาห์

---

## Data Flow v0.1

```
ลูกค้า (CLI input)
    ↓
Claire  →  job dict (JSON)
    ↓
Max     →  pricing_engine.py  →  ใบเสนอราคา
    ↓
OPS     →  สรุปรายการ / ราคารวม
```

---

## v0.2 ที่ทำเสร็จแล้ว

- [x] เพิ่ม `job_id` auto-increment และ persistence ใน SQLite (`data/jobs.db`)
- [x] เพิ่ม status tracking ตามลำดับ รอผลิต → กำลังผลิต → เสร็จแล้ว → ส่งแล้ว
- [x] เพิ่ม API `POST /api/jobs`, `GET /api/jobs`, `GET /api/jobs/:jobId` และ `PATCH /api/jobs/:jobId/status`
- [x] เก็บ pricing snapshot และยอดเงินเป็น satang ณ เวลาสร้าง job

## TODO สำหรับเฟสถัดไป

- [ ] เชื่อม Telegram bot (Claire)
- [ ] เชื่อม Facebook Messenger (Claire)
- [ ] เพิ่ม image input (ภาพตัวอย่างป้าย)
- [ ] PDF quote export
