import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lessonKey, sectionKey, similar, tidyName } from './drive-names.js'

test('Drive names: clutter is removed, the wording is kept', () => {
  const cases: Array<[string, boolean, string]> = [
    ['Copy of 4. 3. Your fiverr profile overview.mp4', true, '3. Your fiverr profile overview'],
    ['06 Master Project_ MealsToGo Project Setup------', false, '06 Master Project: MealsToGo Project Setup'],
    ['15 Adobe Photoshop CC for Beginners: [Photoshop I]Fundamentals', false, '15 Adobe Photoshop CC for Beginners: [Photoshop I] Fundamentals'],
    ['Illustrator-CC-2020-MasterClass', false, 'Illustrator CC 2020 MasterClass'],
    ['3, Chapter 2', false, 'Chapter 2'],
    ['1-Module 1 - Course Introduction', false, 'Module 1 - Course Introduction'],
    ['01 - The Intro Chapter [TutFlix.ORG]', false, '01 - The Intro Chapter'],
    ['6. Responsive design (@free_design_courses)', false, '6. Responsive design'],
    ['820194 - 05 - Exercise 1 Post Your Own Inspirational Quote Graphic.mp4', true, '05 - Exercise 1 Post Your Own Inspirational Quote Graphic'],
    ['01 - 01 Class Preview.mp4', true, '01 - Class Preview'],
    ['02 - knowing-the-basics.mp4', true, '02 - knowing-the-basics'],
    ['002-What is Cyber Security.mp4', true, '002-What is Cyber Security'],
  ]
  for (const [raw, isFile, expected] of cases) assert.equal(tidyName(raw, isFile), expected, raw)
})

test('Drive names: chapters and lessons match the site despite numbering and labels', () => {
  assert.equal(sectionKey('1-Module 1 - Course Introduction'), sectionKey('Course Introduction'))
  assert.equal(sectionKey('2. Adobe XD\'s tools and features (@free_design_courses)'), sectionKey("2. Adobe XD's tools and features"))
  assert.ok(similar(sectionKey('04 - The Kit'), sectionKey('The Kits')))
  assert.ok(!similar(sectionKey('Brushes'), sectionKey('Basics')))
  assert.equal(lessonKey('820194 - 01 - Introduction.mp4'.replace(/\.mp4$/, '')), lessonKey('01 - Introduction'))
  assert.notEqual(lessonKey('06 - Section Intro & Project Files'), lessonKey('12 - Section Intro & Project Files'))
})
