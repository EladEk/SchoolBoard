import React from 'react'
import ClockWidget from '../components/display/ClockWidget'
import CurrentLessonsWidget from '../components/display/CurrentLessonsWidget'
import NewsTickerWidget from '../components/display/NewsTickerWidget'
import BirthdayBannerWidget from '../components/display/BirthdayBannerWidget'

export default function DisplayPage() {
  return (
    <div className="display-root">
      <BirthdayBannerWidget/>
      <div style={{display:'grid', gridTemplateColumns:'1fr auto', gap:24, padding:24}}>
        <CurrentLessonsWidget />
        <ClockWidget />
      </div>
      <NewsTickerWidget />
    </div>
  )
}