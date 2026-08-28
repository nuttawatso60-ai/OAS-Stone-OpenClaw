# Competitor Verification Log — Roi Et

เกณฑ์: แหล่งอ้างอิงต้องผูก **ชื่อร้าน + จังหวัด** เข้าด้วยกัน จึงนับเป็นหลักฐาน
เบอร์ตรงอย่างเดียวไม่พอ. ผ่านเกณฑ์แล้วจึงอัป `verificationStatus` ใน `data/competitors.json`

## 2026-08-28 — exact-match phone search

| ร้าน | เบอร์ที่ค้น | ผล |
|---|---|---|
| บ้านทำป้าย | 0899690509, 0866529984 | ❌ เจอแค่หน้ารวมเบอร์ (muasim.com.vn = เว็บขายซิมเวียดนาม) ไม่ผูกชื่อร้าน/ร้อยเอ็ด |
| ชินนะ แกะสลักป้ายหิน | 0844023812 | ❌ ไม่พบผลยืนยัน |
| พลาญชัยป้ายหิน | 0611698944, 0807574559 | ❌ ไม่พบ (verified อยู่แล้วจาก PDF จัดซื้อ กฟภ. ร้อยเอ็ด) |
| ร้านฟ้าตากแกรนิตร้อยเอ็ด | 0813203678, 0818734189 | ❌ ไม่พบผลยืนยัน |
| ร้านผ่องแกรนิต | 0918412349 | ❌ เจอ "ร้านผ่องใสแกรนิต" — คนละชื่อ ไม่ยืนยันร้อยเอ็ด |

ผล: ไม่มี competitor upgrade, registry/observations ไม่เปลี่ยน

## 2026-08-28 — public-source verification round 2

| คู่แข่ง | source type ที่ค้น | ผล |
|---|---|---|
| ฟ้าตากแกรนิต | Roi Et provincial police meeting report | ✅ ยืนยันชื่อและที่อยู่ในจังหวัดร้อยเอ็ด; upgrade `ran-fa-tak` |
| ป้ายหินแกะสลัก เกษตรวิสัย | public business/search pages | ❌ ยังไม่พบ stable source ที่ยืนยัน exact identity เพียงพอ |
| บ้านทำป้าย | new public-source search | ❌ ผลที่พบเป็นธุรกิจชื่อใกล้เคียงในนครราชสีมา ไม่ยืนยัน Roi Et |
| ชินนะ แกะสลักป้ายหิน | [Facebook Page](https://www.facebook.com/p/%E0%B8%8A%E0%B8%B4%E0%B8%99%E0%B8%99%E0%B8%B0-%E0%B9%81%E0%B8%81%E0%B8%B0%E0%B8%AA%E0%B8%A5%E0%B8%B1%E0%B8%81%E0%B8%9B%E0%B9%89%E0%B8%B2%E0%B8%A2%E0%B8%AB%E0%B8%B4%E0%B8%99-100063441293177/) + exact-name public search | ⚠️ Page slug supports business identity/service lead; Facebook content inaccessible and no independent source confirms Roi Et, keep `pending_verification` |
| ร้านผ่องแกรนิต | new public-source search | ❌ ผลที่พบเป็น `ร้านผ่องใสแกรนิต` คนละชื่อและไม่ยืนยัน Roi Et |
