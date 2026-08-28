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
| ฟ้าตากแกรนิต | official Roi Et government/police report + public directory + Facebook lead | ✅ ยืนยันชื่อและที่อยู่ในจังหวัดร้อยเอ็ด; upgraded `ran-fa-tak`; official PDF เป็นแหล่ง authoritative, Facebook ยังไม่ถูกเพิ่มเป็น source |
| ป้ายหินแกะสลัก เกษตรวิสัย | public business/search pages | ❌ ยังไม่พบ stable source ที่ยืนยัน exact identity เพียงพอ |
| บ้านทำป้าย | new public-source search | ❌ ผลที่พบเป็นธุรกิจชื่อใกล้เคียงในนครราชสีมา ไม่ยืนยัน Roi Et |
| ชินนะ แกะสลักป้ายหิน | exact-name public search | ❌ ไม่พบ source ที่ยืนยัน exact identity + Roi Et/service; Facebook group/profile lead ที่เคยผูกกับรายการนี้ถูกแก้ไขแล้วว่าเป็นของ `บ้านทำป้าย` สาขากาฬสินธุ์ |
| บ้านทำป้าย | address-first public search: `บ้านทำป้ายแกะสลัก`, `119 บ้านสันติภาพ`, `ตำบลรอบเมือง` | ⚠️ Public location data confirms บ้านสันติภาพ in ต.รอบเมือง อ.เมืองร้อยเอ็ด, but no source ties the business name กับเลขที่ 119; keep `pending_verification` |
| บ้านทำป้าย — Kalasin branch lead | [Facebook group/profile lead](https://www.facebook.com/groups/1703713003177632/user/100012742930398/) + public business search | ⚠️ User correction identifies this lead as related to บ้านทำป้าย in Kalasin; no public business-level source confirms the branch, keep as supporting intelligence only |
| พลาญชัยป้ายหิน101 | Facebook profile/page `https://www.facebook.com/profile.php?id=61566473556055&sk=reels_tab` + exact-name public search | Facebook lead supplied: พลาญชัยป้ายหิน101; public identity/location linkage not independently confirmed yet. Existing official PEA/OIC evidence remains authoritative. |
| ร้านผ่องแกรนิต | new public-source search | ❌ ผลที่พบเป็น `ร้านผ่องใสแกรนิต` คนละชื่อและไม่ยืนยัน Roi Et |

## 2026-08-28 — public-source verification round 3

| คู่แข่ง | source type ใหม่ | ผล |
|---|---|---|
| ป้ายหินแกะสลัก เกษตรวิสัย | exact Place ID `ChIJqwW3GwCLFzERhWbYlIWQjiI`, `MH4P+GRV`, Google/Maps-style, directory and local-government search | ⚠️ ไม่พบ stable public place URL หรือผลที่ผูก exact identity กับเกษตรวิสัย/ร้อยเอ็ด; ผล postcode/general หรือธุรกิจอื่นไม่พอ; keep `pending_verification` |
| ชินนะ แกะสลักป้ายหิน | exact-name, Page ID, Google/Maps-style, local procurement and public business search | ❌ ไม่พบ source ใหม่ที่ยืนยัน exact identity + Roi Et; ผลที่พบเป็นธุรกิจ/บริการอื่น; keep `pending_verification` |
| ร้านผ่องแกรนิต | exact-name, Roi Et, Google/Maps-style, procurement and public business search | ❌ ไม่พบ exact attributable source ใหม่; ผลที่พบไม่ใช่ชื่อ exact; keep `pending_verification` |
| บ้านทำป้าย | exact coordinates `16.0356508,103.6562492`, Google/Maps-style and address-linked search | Google Street View lead at 16.0356508,103.6562492 is geographically consistent with Rop Mueang, Roi Et; business identity still requires independent public linkage. |
| บ้านทำป้าย — Kalasin lead | Google Maps/Street View, `16.4267193,103.5183828` | location confirmed as ต.เหนือ อ.เมืองกาฬสินธุ์ จ.กาฬสินธุ์; business-name/brand linkage still requires public verification |

## 2026-08-28 — Google Maps place resolution round 4

| คู่แข่ง | source type ใหม่ | ผล |
|---|---|---|
| บ้านทำป้าย | place-ID/directions resolution `0x3117fd92c38130e7:0xd177ad368328627e` + exact destination search | ไม่พบ stable public business/place URL ที่ resolve ได้; destination text เป็น lead แต่ยังไม่พอ verify `baan-tham-pai`; keep `pending_verification` |

## 2026-08-28 — Google Maps place resolution round 4 follow-up

| คู่แข่ง | source type ใหม่ | ผล |
|---|---|---|
| บ้านทำป้าย | Google Maps CID `15093723125795807870` from place identifier `0x3117fd92c38130e7:0xd177ad368328627e` | ✅ resolved stable place URL `https://www.google.com/maps?cid=15093723125795807870`; public business profile shows `ร้านบ้านทำป้ายแกะสลัก`, `บ้านสันติภาพ 119 ตำบล รอบเมือง อำเภอเมืองร้อยเอ็ด 45000`; upgraded `baan-tham-pai` |

## 2026-08-28 — public-source verification round 5

| คู่แข่ง | source type ใหม่ | ผล |
| ------- | ---------------- | -- |
| ชินนะ แกะสลักป้ายหิน | supplied Facebook Page URL/Page ID `100063441293177` public About/location data | ✅ public page shows `ชินนะ แกะสลักป้ายหิน` and `Roi Et, Thailand, 45170`; upgraded `chinna-kae-salak-pai-hin` |
| ป้ายหินแกะสลัก เกษตรวิสัย | Google Maps direct Place ID/CID resolution from `ChIJqwW3GwCLFzERhWbYlIWQjiI` to CID `2490086547384723077` | ✅ stable place URL `https://www.google.com/maps?cid=2490086547384723077` shows `ป้ายหินแกะสลัก`, `MH4P+GRV ตำบล เกษตรวิสัย อำเภอ เกษตรวิสัย ร้อยเอ็ด 45150`; upgraded `pai-hin-kae-salak-kasetwisai` |
| ร้านผ่องแกรนิต | exact Google Maps search for `ร้านผ่องแกรนิต ร้อยเอ็ด` resolved business profile CID `2460950551785954836`; exact web search also surfaced only false positive `ผ่องใสแกรนิต` Nonthaburi | ✅ Maps profile shows source-backed name `ผ่องแกรนิต`, `232 ตำบล ในเมือง อำเภอเมืองร้อยเอ็ด ร้อยเอ็ด 45000`; upgraded `ran-phong-granite`; rejected `ผ่องใสแกรนิต` as non-exact/Nonthaburi |

## 2026-08-28 — reproducible-source review fix

| คู่แข่ง | source type ใหม่ | ผล |
| ------- | ---------------- | -- |
| ป้ายหินแกะสลัก เกษตรวิสัย | public Google Maps `query_place_id` URL for `ChIJqwW3GwCLFzERhWbYlIWQjiI`; public HTML exposes the Place ID but not CID `2490086547384723077` | kept verified with `https://www.google.com/maps/search/?api=1&query=MH4P%2BGRV%2C%20Kaset%20Wisai%2C%20Roi%20Et%2C%20Thailand&query_place_id=ChIJqwW3GwCLFzERhWbYlIWQjiI`; removed inferred CID as source evidence |
| ชินนะ แกะสลักป้ายหิน | indexed search for Page ID/name/location and public Facebook URL re-check | exact `Roi Et, Thailand, 45170` location was visible only in authenticated/local Facebook view and not reproduced by indexed/public source; reverted `chinna-kae-salak-pai-hin` to `pending_verification` |
| ร้านผ่องแกรนิต | public Maps CID/HTML check and exact web search; `ผ่องใสแกรนิต` appeared as false positive | CID `2460950551785954836` did not expose exact public metadata outside local Maps view; reverted `ran-phong-granite` to `pending_verification` and restored display name `ร้านผ่องแกรนิต` |
