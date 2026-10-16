import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findSchool, schoolsForCourse } from './school-lineup.js'

const names = (title: string) => schoolsForCourse(title).map((school) => school.name)

test('shared courses belong to both schools, home school first', () => {
  assert.deepEqual(names('UI/UX Design'), ['School of Design', 'School of Products'])
  assert.deepEqual(names('Smart Phone Videography And Content Creation'), ['School of Content Creation', 'School of Smartphone Creators'])
})

test('titles match loosely but not across different programmes', () => {
  assert.deepEqual(names('Cloud Engineering'), ['School of Engineering'])
  assert.deepEqual(names('Data Analysis with Excel'), ['School of Data'])
  assert.deepEqual(names('Mobile Graphics Design'), ['School of Smartphone Creators'])
  assert.deepEqual(names('Graphics Design'), ['School of Design'])
  assert.deepEqual(names('Product Management'), ['School of Products'])
  assert.deepEqual(names('CV & LinkedIn Masterclass'), [])
})

test('the renamed smartphone school still matches its old category name', () => {
  assert.equal(findSchool('School Of Smart Phone')?.name, 'School of Smartphone Creators')
})
