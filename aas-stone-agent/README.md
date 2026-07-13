# aas-stone-agent

ฐานความรู้ local-first สำหรับร้าน อ.เอ.เอส แกะสลัก เพื่อเตรียมข้อมูลตอบแชท Facebook และ LINE ในเฟสถัดไป

ขอบเขตรอบนี้: อ่านไฟล์แชท `.txt`, สกัดคำถามซ้ำ, และสร้าง JSON ฐานความรู้เท่านั้น ไม่มี Facebook API, LINE API, AI Agent, database หรือการส่งข้อความจริง

## โครงสร้าง

- `knowledge/` ข้อมูลที่เจ้าของร้านตรวจและแก้ไขได้
- `chat_history/` วางไฟล์แชท `.txt` ได้ทั้งโฟลเดอร์ย่อย
- `generated/` ไฟล์ JSON ที่สร้างจากคำสั่ง
- `prompts/` prompt template สำหรับเฟสเชื่อม Bot
- `integrations/` เอกสารเตรียม integration ในอนาคต
- `output/` เก็บผลส่งออกในอนาคต

## วิธีใช้

1. เติมข้อมูลจริงใน `knowledge/business.txt`, `knowledge/pricing.txt`, `knowledge/faq.txt` และ `knowledge/portfolio.txt`
2. วางไฟล์แชทเก่า `.txt` ใน `chat_history/`
3. รันคำสั่งจากโฟลเดอร์นี้

```powershell
cd D:\OAS-Stone-OpenClaw\aas-stone-agent
npm.cmd run import
npm.cmd run analyze
npm.cmd run build
```

## ผลลัพธ์

- `npm.cmd run import` อ่านและแสดงเนื้อหา `.txt` ทุกไฟล์ใน `chat_history/`
- `npm.cmd run analyze` สร้าง `generated/customer_questions.json`
- `npm.cmd run build` สร้าง/อัปเดต `faq_generated.json`, `customer_questions.json`, `response_patterns.json` และ `handoff_rules.json`

## ข้อมูลที่ต้องเพิ่มภายหลัง

- ราคาและเงื่อนไขที่เจ้าของร้านอนุมัติ
- FAQ คำตอบจริง
- Portfolio และรูปตัวอย่างที่ได้รับอนุญาต
- ข้อมูลติดต่อ เวลาทำการ พื้นที่บริการ
- ไฟล์แชทเก่าที่คัดข้อมูลส่วนบุคคล/ข้อมูลลับออกแล้ว
