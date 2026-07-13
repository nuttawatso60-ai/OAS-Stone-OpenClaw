# AI Workspace Overview

โปรเจกต์นี้เป็นระบบ AI workflow สำหรับร้านแกะสลักหิน
ใช้ AI agent ช่วยงาน:
- coding
- quotation
- customer support
- content generation
- CNC workflow
- business memory

## Environment

OS:
- Windows
- ใช้ PowerShell เป็นหลัก

Main Stack:
- OpenClaw
- Claude
- Gemini
- LiteLLM
- VS Code

## Important Rules

- ใช้ภาษาไทยเป็นหลัก
- simplicity > complexity
- ห้าม refactor ใหญ่โดยไม่จำเป็น
- ห้ามเปลี่ยน workflow CNC โดยไม่ถาม
- ถ้าไม่มั่นใจ ให้ถามก่อนแก้ logic สำคัญ

## CNC Machine

Controller:
- DDCS v3.1

Machine:
- CNC Router 122x244cm
- Spindle 3kW ER20

Software:
- Aspire 10.5
- CorelDRAW 2024
- CorelDRAW X7
- ArtCAM 2018

## Business

ร้าน:
โอ.เอ.เอส. แกะสลักหิน

งานหลัก:
- ป้ายหิน
- ป้ายสุสาน
- แกะสลัก CNC
- งานอะคริลิก
- ป้ายสั่งทำ

## Memory Rules

ก่อนเริ่ม task:
1. อ่านไฟล์ที่เกี่ยวข้อง
2. ห้ามอ่านทั้ง repo ถ้าไม่จำเป็น
3. สรุปสิ่งที่เข้าใจก่อนแก้ระบบใหญ่

หลังจบ task:
- update debug log
- update decision log
- update known issues ถ้ามี

## Folder Guide

vault/00_System
ภาพรวมระบบ

vault/01_Business
ข้อมูลธุรกิจ

vault/02_Agents
memory ของแต่ละ agent

vault/03_Projects
ข้อมูลแต่ละโปรเจกต์

vault/04_Debug
bug และวิธีแก้

vault/05_Knowledge
knowledge base

vault/06_Prompts
prompt ใช้ซ้ำ