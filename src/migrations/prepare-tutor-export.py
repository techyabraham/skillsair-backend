"""Prepare the Tutor LMS ZIP and WordPress user CSV for SkillsAir import.

This runs locally with Python's standard library. It does not connect to Payload.
It creates users.csv, courses.csv, active-enrollments.csv, and audit files.
"""
from __future__ import annotations

import argparse
import csv
import html
import json
import re
import zipfile
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qs, urlparse


COURSE_FILE = re.compile(r"courses/(\d+)/(\d+)\.json$")
USER_FIELDS = ["wp_user_id", "email", "first_name", "last_name", "phone", "wp_roles", "is_student", "is_active", "marketing_consent"]
COURSE_FIELDS = ["course_title", "course_slug", "instructor_email", "price", "level", "status", "category", "section_title", "section_order", "lesson_title", "lesson_order", "lesson_duration", "lesson_drive_file_id", "is_free", "is_published", "course_short_description", "course_description_json", "course_thumbnail_source_url", "course_preview_video", "lesson_content_json", "lesson_attachment_source_urls_json"]
ENROLLMENT_FIELDS = ["student_email", "course_slug", "status", "enrolled_at", "completed_at", "progress_percent", "order_id"]


def first(value):
    return value[0] if isinstance(value, list) and value else (None if isinstance(value, list) else value)


def text(value) -> str:
    value = first(value)
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return ""
    return str(value).strip()


def scalar_meta(meta: dict, key: str) -> str:
    return text(meta.get(key))


class TextExtractor(HTMLParser):
    BLOCKS = {"p", "div", "br", "li", "h1", "h2", "h3", "h4", "h5", "h6", "tr"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() in self.BLOCKS:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag.lower() in self.BLOCKS:
            self.parts.append("\n")

    def handle_data(self, data):
        self.parts.append(data)


def html_blocks(value: str) -> list[str]:
    parser = TextExtractor()
    parser.feed(value or "")
    raw = html.unescape("".join(parser.parts))
    return [re.sub(r"\s+", " ", part).strip() for part in re.split(r"\n+", raw) if part.strip()]


def text_node(value: str) -> dict:
    return {"detail": 0, "format": 0, "mode": "normal", "style": "", "text": value, "type": "text", "version": 1}


def lexical(blocks: list[str], links: list[tuple[str, str]] | None = None) -> str:
    children = []
    for block in blocks:
        children.append({"children": [text_node(block)], "direction": "ltr", "format": "", "indent": 0, "type": "paragraph", "version": 1, "textFormat": 0, "textStyle": ""})
    for label, url in links or []:
        if not url:
            continue
        link = {"children": [text_node(label)], "direction": None, "fields": {"linkType": "custom", "newTab": True, "url": url}, "format": "", "indent": 0, "type": "link", "version": 3}
        children.append({"children": [link], "direction": "ltr", "format": "", "indent": 0, "type": "paragraph", "version": 1, "textFormat": 0, "textStyle": ""})
    return json.dumps({"root": {"children": children, "direction": None, "format": "", "indent": 0, "type": "root", "version": 1}}, ensure_ascii=False, separators=(",", ":"))


def as_list(value):
    return value if isinstance(value, list) else []


def drive_id(value: str) -> str:
    if not value:
        return ""
    parsed = urlparse(value)
    match = re.search(r"/d/([A-Za-z0-9_-]+)", parsed.path)
    if match:
        return match.group(1)
    return parse_qs(parsed.query).get("id", [""])[0]


def video_info(lesson: dict) -> tuple[str, str, str]:
    video = first((lesson.get("meta") or {}).get("_video"))
    if not isinstance(video, dict):
        return "", "", ""
    drive_url = text(video.get("source_google_drive"))
    html5_url = text(video.get("source_html5"))
    video_id = text(video.get("source_video_id"))
    source = text(video.get("source")).lower()
    if "google" in source and not drive_url:
        drive_url = video_id
    file_id = drive_id(drive_url) or (drive_url if re.fullmatch(r"[A-Za-z0-9_-]{10,}", drive_url) else "")
    if not file_id and html5_url:
        parsed_html5 = urlparse(html5_url)
        if parsed_html5.hostname == "api.skillsair.com" and parsed_html5.path == "/wp-admin/admin-ajax.php" and parse_qs(parsed_html5.query).get("action") == ["igd_stream"]:
            candidate = parse_qs(parsed_html5.query).get("id", [""])[0]
            if re.fullmatch(r"[A-Za-z0-9_-]{10,}", candidate):
                file_id = candidate
    duration = first(video.get("duration_sec"))
    try:
        seconds = str(max(0, int(float(duration)))) if duration not in (None, "") else ""
    except (TypeError, ValueError):
        seconds = ""
    if not seconds:
        runtime = first(video.get("runtime"))
        if isinstance(runtime, dict):
            try:
                seconds = str(int(text(runtime.get("hours") or 0)) * 3600 + int(text(runtime.get("minutes") or 0)) * 60 + int(text(runtime.get("seconds") or 0)))
            except ValueError:
                seconds = ""
    return file_id, html5_url, seconds


def write_csv(path: Path, fields: list[str], rows: list[dict]):
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser(description="Convert SkillsAir's Tutor LMS ZIP and user list into Payload import CSVs.")
    parser.add_argument("users_csv", type=Path)
    parser.add_argument("tutor_zip", type=Path)
    parser.add_argument("output_dir", type=Path)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)

    with args.users_csv.open(newline="", encoding="utf-8-sig") as stream:
        source_users = list(csv.DictReader(stream))
    users_by_email = {}
    for row in source_users:
        email = text(row.get("email") or row.get("user_email")).lower()
        if not email or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
            raise ValueError("User CSV contains a blank or invalid email; fix it before import.")
        if email in users_by_email:
            raise ValueError("User CSV contains duplicate email addresses; fix them before import.")
        users_by_email[email] = row

    with zipfile.ZipFile(args.tutor_zip) as archive:
        courses = {}
        for name in archive.namelist():
            if not COURSE_FILE.search(name):
                continue
            doc = json.loads(archive.read(name))
            outer = first(doc.get("data")) or {}
            course = ((outer.get("data") or {}).get("course") or {}) if isinstance(outer, dict) else {}
            if course.get("ID") is not None:
                courses[str(course["ID"])] = course

        enrollment_records = []
        for name in archive.namelist():
            if not name.endswith("/enrollments.json"):
                continue
            doc = json.loads(archive.read(name))
            for outer in as_list(doc.get("data")):
                data = outer.get("data", {}) if isinstance(outer, dict) else {}
                enrollment_records.extend(r for r in as_list(data.get("enrollments")) if isinstance(r, dict))

    statuses = Counter(text((record.get("enrollment") or {}).get("post_status")).lower() or "(blank)" for record in enrollment_records)
    active_pairs = {}
    unmatched_active = []
    for record in enrollment_records:
        enrollment = record.get("enrollment") or {}
        if text(enrollment.get("post_status")).lower() != "completed":
            continue
        student = (record.get("student") or {}).get("data") or {}
        email = text(student.get("user_email")).lower()
        course = courses.get(str(enrollment.get("post_parent") or ""))
        if email not in users_by_email or not course:
            unmatched_active.append({"student_email": email, "course_id": text(enrollment.get("post_parent")), "reason": "email or exported course not found"})
            continue
        slug = text(course.get("post_name"))
        key = (email, slug)
        if key in active_pairs:
            raise ValueError("Duplicate active user/course enrollment found; reconcile before import.")
        enrolled_at = text(enrollment.get("post_date_gmt")) or text(enrollment.get("post_date"))
        if enrolled_at.startswith("0000-00-00"):
            enrolled_at = ""
        if enrolled_at and not enrolled_at.endswith("Z") and "+" not in enrolled_at:
            enrolled_at = enrolled_at.replace(" ", "T") + "Z"
        active_pairs[key] = {"student_email": email, "course_slug": slug, "status": "active", "enrolled_at": enrolled_at, "completed_at": "", "progress_percent": "0", "order_id": ""}

    active_emails = {email for email, _slug in active_pairs}
    user_rows = []
    for email, row in users_by_email.items():
        user_rows.append({
            "wp_user_id": "",
            "email": email,
            "first_name": text(row.get("first_name")),
            "last_name": text(row.get("last_name")),
            "phone": text(row.get("phone")),
            "wp_roles": text(row.get("wp_roles") or row.get("roles") or row.get("role")),
            "is_student": "true" if email in active_emails else "false",
            "is_active": "true",
            "marketing_consent": "unknown",
        })

    course_rows = []
    media_uses = Counter()
    all_levels_count = 0
    for source_id, course in courses.items():
        meta = course.get("meta") or {}
        slug = text(course.get("post_name"))
        price = scalar_meta(meta, "tutor_course_sale_price") or scalar_meta(meta, "tutor_course_price") or "0"
        try:
            price = str(max(0, float(price)))
        except ValueError:
            price = "0"
        level = scalar_meta(meta, "_tutor_course_level").lower()
        if level not in {"beginner", "intermediate", "advanced"}:
            level = "beginner"
            all_levels_count += 1
        status = "published" if text(course.get("post_status")) == "publish" else "draft"
        description = lexical(html_blocks(text(course.get("post_content")))) if text(course.get("post_content")) else ""
        thumbnail = text(course.get("thumbnail_url"))
        if thumbnail:
            media_uses[(thumbnail, "course_thumbnail")] += 1
        topics = as_list(course.get("contents"))
        lesson_count = 0
        for section_index, topic in enumerate(topics, 1):
            if not isinstance(topic, dict):
                continue
            section_title = text(topic.get("post_title")) or f"Section {section_index}"
            section_order = text(topic.get("menu_order")) or str(section_index)
            for lesson_index, lesson in enumerate(as_list(topic.get("children")), 1):
                if not isinstance(lesson, dict) or lesson.get("post_type") != "lesson":
                    continue
                lesson_count += 1
                file_id, video_url, duration = video_info(lesson)
                links = []
                if video_url:
                    links.append(("Legacy lesson video source", video_url))
                    media_uses[(video_url, "legacy_video")]+=1
                for url in as_list(lesson.get("attachment_links")):
                    url = text(url)
                    if url.startswith(("http://", "https://")):
                        links.append(("Legacy lesson attachment", url))
                        media_uses[(url, "lesson_attachment")]+=1
                body_blocks = html_blocks(text(lesson.get("post_content")))
                body = lexical(body_blocks, links) if body_blocks or links else ""
                is_free = text(first((lesson.get("meta") or {}).get("_is_preview"))).lower() in {"1", "yes", "true"}
                course_rows.append({
                    "course_title": text(course.get("post_title")), "course_slug": slug, "price": price,
                    "level": level, "status": status, "section_title": section_title,
                    "section_order": section_order, "lesson_title": text(lesson.get("post_title")),
                    "lesson_order": text(lesson.get("menu_order")) or str(lesson_index), "lesson_duration": duration,
                    "lesson_drive_file_id": file_id, "is_free": str(is_free).lower(),
                    "is_published": str(text(lesson.get("post_status")) == "publish").lower(),
                    "course_description_json": description,
                    "lesson_content_json": body,
                })
                if not video_url and not file_id:
                    video = first((lesson.get("meta") or {}).get("_video"))
                    if isinstance(video, dict):
                        gdrive = text(video.get("source_google_drive"))
                        if gdrive.startswith(("http://", "https://")):
                            media_uses[(gdrive, "google_drive_video")]+=1
        if lesson_count == 0:
            course_rows.append({
                "course_title": text(course.get("post_title")), "course_slug": slug,
                "price": price, "level": level, "status": status,
                "course_description_json": description,
            })

    write_csv(args.output_dir / "users.csv", USER_FIELDS, user_rows)
    write_csv(args.output_dir / "courses.csv", COURSE_FIELDS, course_rows)
    write_csv(args.output_dir / "active-enrollments.csv", ENROLLMENT_FIELDS, list(active_pairs.values()))
    write_csv(args.output_dir / "unmatched-active-enrollments.csv", ["student_email", "course_id", "reason"], unmatched_active)
    write_csv(args.output_dir / "media-sources.csv", ["source_url", "usage", "occurrences"], [{"source_url": url, "usage": usage, "occurrences": count} for (url, usage), count in sorted(media_uses.items())])

    summary = [
        "Tutor LMS migration preparation audit",
        f"WordPress users: {len(user_rows)} (all included)",
        f"Courses: {len(courses)}; course import rows including lessons/course-only rows: {len(course_rows)}",
        f"Matched active enrollments imported: {len(active_pairs)} across {len(active_emails)} users",
        f"Unmatched active enrollments: {len(unmatched_active)}",
        f"Tutor enrollment statuses excluded from active access: {dict(statuses)} (only source status 'completed' was mapped to target status 'active')",
        f"Courses with source level 'all_levels' mapped to target 'beginner' because SkillsAir has no 'all_levels' option: {all_levels_count}",
        "Learning progress was absent in the source ZIP; imported enrollment progress is 0%.",
        "The ZIP contains media URLs, not media files. media-sources.csv is a reference list; these files must be copied into SkillsAir media storage or kept available at their current URLs.",
        "No quiz, review, or discussion records were added by this preparation step.",
        "Marketing consent was not included in the source CSV, so all users are marked 'unknown'.",
    ]
    (args.output_dir / "audit.txt").write_text("\n".join(summary) + "\n", encoding="utf-8")
    print("Prepared import files. No records were sent to or written into the backend.")
    print(f"Users: {len(user_rows)}; courses: {len(courses)}; lessons: {sum(1 for r in course_rows if r.get('lesson_title'))}; active enrollments: {len(active_pairs)}; media source references: {len(media_uses)}")


if __name__ == "__main__":
    main()
