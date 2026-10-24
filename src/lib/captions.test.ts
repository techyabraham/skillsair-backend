import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanCueText, convertSrt, findSubtitle, isUrlOnly, parseSrt, parseTranscript, subtitleBase, tidyCues, toVtt, transcriptLines, transcriptText, vttTime } from './captions.js'

const SRT = `﻿1\r\n00:00:01,000 --> 00:00:03,500\r\n<i>Welcome</i> to the course\r\n\r\n2\r\n00:00:03,600 --> 00:00:04,000\r\nok\r\n\r\n3\r\n00:00:04,100 --> 00:00:06,000\r\nwww.tutflix.org\r\n\r\n00:00:31.000 --> 00:00:33.000\r\n{\\an8}Next we &amp; you\r\n`

test('captions: SRT parsing is tolerant of BOM, CRLF, missing numbers and dot milliseconds', () => {
  const cues = parseSrt(SRT)
  assert.equal(cues.length, 4)
  assert.equal(cues[0]?.text, 'Welcome to the course')
  assert.equal(cues[3]?.start, 31)
  assert.equal(cues[3]?.text, 'Next we & you')
})

test('captions: doubled carriage returns (\\r\\r\\n) still give one cue per subtitle', () => {
  const cues = parseSrt('1\r\r\n00:00:04,110 --> 00:00:07,190\r\r\nHey Guys welcome\r\r\n\r\r\n2\r\r\n00:00:07,200 --> 00:00:11,580\r\r\nWe are going to talk,\r\r\nwhy we made it,\r\r\n')
  assert.equal(cues.length, 2)
  assert.equal(cues[0]?.text, 'Hey Guys welcome')
  assert.equal(cues[1]?.text, 'We are going to talk,\nwhy we made it,')
})

test('captions: web addresses are dropped and very short cues merged', () => {
  assert.ok(isUrlOnly('www.tutflix.org'))
  assert.ok(isUrlOnly('Visit: https://example.com/x'.replace('Visit: ', '')))
  assert.ok(!isUrlOnly('Go to example.com and sign up'))
  const cues = tidyCues(parseSrt(SRT))
  assert.equal(cues.length, 2)
  assert.equal(cues[0]?.text, 'Welcome to the course\nok')
  assert.equal(cues[0]?.end, 4)
})

test('captions: WebVTT output and times', () => {
  assert.equal(vttTime(3723.5), '01:02:03.500')
  const vtt = toVtt([{ start: 1, end: 2.25, text: 'Hello' }])
  assert.equal(vtt, 'WEBVTT\n\n00:00:01.000 --> 00:00:02.250\nHello\n')
})

test('captions: transcript lines every ~30 seconds round-trip', () => {
  const lines = transcriptLines([{ start: 0, end: 2, text: 'One' }, { start: 10, end: 12, text: 'two' }, { start: 31, end: 33, text: 'Three' }])
  assert.deepEqual(lines, [{ start: 0, text: 'One two' }, { start: 31, text: 'Three' }])
  const text = transcriptText(lines)
  assert.equal(text, '[00:00] One two\n[00:31] Three')
  assert.deepEqual(parseTranscript(text), lines)
})

test('captions: malformed and empty files give no captions', () => {
  assert.equal(convertSrt('not a subtitle file'), null)
  assert.equal(convertSrt('1\n00:00:05,000 --> 00:00:04,000\nbackwards\n'), null)
  assert.equal(cleanCueText('<font color="#fff">Hi</font>\n  there '), 'Hi\nthere')
})

test('captions: subtitle files pair with their video despite case, "Copy of" and language suffixes', () => {
  const siblings = [{ name: 'Copy of 1. Intro.SRT' }, { name: '2. Next lesson_en.srt' }, { name: '2. Next lesson.mp4' }]
  assert.equal(findSubtitle('1. intro.mp4', siblings)?.name, 'Copy of 1. Intro.SRT')
  assert.equal(findSubtitle('2. Next lesson.mp4', siblings)?.name, '2. Next lesson_en.srt')
  assert.equal(findSubtitle('3. Missing.mp4', siblings), undefined)
  assert.equal(subtitleBase("002 Matt's Story_en.vtt"), subtitleBase("002 Matt's Story.mp4"))
})

test('captions: WebVTT subtitle files are used when there is no .srt', () => {
  const siblings = [{ name: '1. Why learn Illustrator.vtt' }, { name: '2. How to Study.vtt' }, { name: '2. How to Study.srt' }]
  assert.equal(findSubtitle('1. Why learn Illustrator.mp4', siblings)?.name, '1. Why learn Illustrator.vtt')
  assert.equal(findSubtitle('2. How to Study.mp4', siblings)?.name, '2. How to Study.srt')
  const converted = convertSrt('WEBVTT\n\nNOTE made by hand\n\n00:01.000 --> 00:04.000 align:start\nHello and welcome\n\n00:00:04.500 --> 00:00:07.000\nto Illustrator\n')
  assert.equal(converted?.cueCount, 2)
  assert.match(converted?.transcript ?? '', /Hello and welcome/)
})
