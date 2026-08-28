# OAS Stone Engraving — Agent Specs v0.1

## ภาพรวม

ระบบใช้ agent หลักสำหรับรับงาน คำนวณราคา และงานปฏิบัติการ โดยช่องทาง Telegram ถูกกำหนดเป็นเครื่องมือภายในร้านสำหรับเจ้าของและพนักงาน

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
- Telegram ปัจจุบันไม่ได้ใช้เป็นช่อง customer intake

---

## Max — Quotation Agent

**บทบาท:** รับ job dict จาก Claire → รัน pricing engine → ส่งใบเสนอราคากลับ

**Input:** job dict (JSON)

**Output:**
- ใบเสนอราคาแบบ breakdown (รายการ + ราคา + รวม)
- ระบุว่าเป็น "ราคาประมาณ" เสมอ
- แนะนำให้ลูกค้ายืนยันกับร้านก่อนโอนเงิน

**ข้อจำกัด v0.1:**
- ราคาเป็นการประมาณเบื้องต้นเท่านั้น
- ไม่รวมค่าออกแบบพิเศษ / ค่าแบบ
- ไม่รวม VAT

---

## OPS — Operations Manager Agent

**บทบาท:** ติดตามสถานะงาน / รายงานภายใน / เครื่องมือช่วยพนักงาน

**ใน v0.2+ ที่ทำแล้ว:**
- บันทึก job ลง SQLite และติดตาม status: รอผลิต / กำลังผลิต / เสร็จแล้ว / ส่งแล้ว
- รายงานสถานะ คิวงาน รายวัน และรายสัปดาห์ผ่าน OPS API
- Telegram transport สำหรับ Staff Assistant แบบ long polling
- จำกัด Telegram ด้วย `TELEGRAM_ALLOWED_CHAT_IDS`; ผู้ใช้นอก allowlist จะไม่ได้รับคำตอบ
- ถ้า allowlist หายหรือรูปแบบผิด bot จะไม่เริ่มทำงาน

**ทิศทาง Staff Assistant:**
- `/price` คำนวณราคาจาก pricing engine แบบ deterministic
- `/materials` และ `/sizes` ค้นข้อมูลมาตรฐานร้าน
- `/train` และ `/quiz` สำหรับฝึกพนักงาน
- `/market` สำหรับ market intelligence ภายในร้าน

---

## Data Flow

```
ลูกค้า → Claire → job dict → Max → pricing engine
                             ↓
                           OPS / SQLite

เจ้าของร้าน / พนักงานที่อยู่ allowlist
             ↓
Telegram Staff Assistant
             ↓
ราคา / ขนาด / วัสดุ / training / market intelligence
```

---

## v0.2 ที่ทำเสร็จแล้ว

- [x] เพิ่ม `job_id` auto-increment และ persistence ใน SQLite (`data/jobs.db`)
- [x] เพิ่ม status tracking ตามลำดับ รอผลิต → กำลังผลิต → เสร็จแล้ว → ส่งแล้ว
- [x] เพิ่ม API `POST /api/jobs`, `GET /api/jobs`, `GET /api/jobs/:jobId` และ `PATCH /api/jobs/:jobId/status`
- [x] เก็บ pricing snapshot และยอดเงินเป็น satang ณ เวลาสร้าง job
- [x] เพิ่ม OPS summary, queue และรายงานรายวัน/รายสัปดาห์ โดยใช้เวลา Asia/Bangkok แบบคงที่
- [x] นิยาม created จาก `created_at` และ delivered จาก `updated_at` เฉพาะงานสถานะ `ส่งแล้ว`
- [x] เพิ่ม Telegram Staff Assistant transport
- [x] เพิ่ม Telegram staff allowlist แบบ fail-closed และ silent deny

ข้อจำกัดการรายงาน:
- ยังไม่มี completion-at history; delivered จึงอิง `updated_at` ของสถานะ terminal `ส่งแล้ว`
- server bind เฉพาะ `127.0.0.1`; การเปิด LAN ต้องมีการตัดสินใจและเพิ่ม authentication/access control ก่อน

## TODO สำหรับเฟสถัดไป

- [ ] ต่อ `/price` เข้ากับ pricing engine แบบ deterministic
- [ ] เพิ่ม knowledge base สำหรับ `/materials`, `/sizes`, `/train`, `/quiz`
- [ ] เพิ่ม market intelligence collector และ `/market`
- [ ] เชื่อม Facebook Messenger (Claire)
- [ ] เพิ่ม image input (ภาพตัวอย่างป้าย)
- [ ] PDF quote export
