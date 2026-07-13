# DDCS Notes

## Controller

DDCS v3.1

## วิธีใช้งานทั่วไป

- ส่ง G-code ผ่าน flash drive
- ไม่ต้องใช้ Mach3 runtime

## Known Issues

### USB disconnect

อาการ:
- ไฟล์อ่านไม่ครบ
- controller มองไม่เห็น USB

วิธีแก้:
- format FAT32
- ใช้ flash drive คุณภาพดี
- ห้ามเสียบผ่าน hub

---

### Lost steps

อาการ:
- ตำแหน่งเพี้ยน

สาเหตุ:
- feed rate สูงเกิน
- acceleration สูงเกิน

วิธีแก้:
- ลด feed
- เช็ค coupling

---

### Spindle noise

สาเหตุ:
- grounding ไม่ดี
- สาย inverter ใกล้ signal cable

วิธีแก้:
- แยกสายไฟ
- เพิ่ม grounding