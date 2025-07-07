const eventTimezoneOffsetHoursFromUTC = 10;

const eventMonthLocal = 7;
const eventDayLocal = 8;
const eventYearLocal = 2025;
const eventHourLocal = 9;
const eventMinuteLocal = 0;
const eventSecondLocal = 0;



const tempDateForCalculation = new Date(Date.UTC(
    eventYearLocal,
    eventMonthLocal - 1,
    eventDayLocal,
    eventHourLocal - eventTimezoneOffsetHoursFromUTC,
    eventMinuteLocal,
    eventSecondLocal
));

const targetYearUTC = tempDateForCalculation.getUTCFullYear();
const targetMonthUTC = tempDateForCalculation.getUTCMonth();
const targetDayUTC = tempDateForCalculation.getUTCDate();
const targetHourUTC = tempDateForCalculation.getUTCHours();
const targetMinuteUTC = tempDateForCalculation.getUTCMinutes();
const targetSecondUTC = tempDateForCalculation.getUTCSeconds();


function createCountdown(
    utcYear,
    utcMonthIndex,
    utcDay,
    utcHour = 0,
    utcMinute = 0,
    utcSecond = 0
) {
    const second = 1000,
        minute = second * 60,
        hour = minute * 60,
        day = hour * 24;

    let countdownDate = Date.UTC(
        utcYear,
        utcMonthIndex,
        utcDay,
        utcHour,
        utcMinute,
        utcSecond
    );

    const nowMs = new Date().getTime();
    const currentYearUTC = new Date(nowMs).getUTCFullYear();

    if (countdownDate < nowMs && utcYear === currentYearUTC) {
        let nextYear = currentYearUTC + 1;
        countdownDate = Date.UTC(
            nextYear,
            utcMonthIndex,
            utcDay,
            utcHour,
            utcMinute,
            utcSecond
        );
    }


    const x = setInterval(() => {
        const currentNowMs = Date.now();
        const distance = countdownDate - currentNowMs;

        document.getElementById("days").innerText = Math.floor(distance / day);
        document.getElementById("hours").innerText = Math.floor((distance % day) / hour);
        document.getElementById("minutes").innerText = Math.floor((distance % hour) / minute);
        document.getElementById("seconds").innerText = Math.floor((distance % minute) / second);

        if (distance < 0) {
            document.getElementById("headline").innerText = "It's here!";
            document.getElementById("countdown").style.display = "none";
            document.getElementById("content").style.display = "block";
            clearInterval(x);
        }
    }, 0);
}

createCountdown(targetYearUTC, targetMonthUTC, targetDayUTC, targetHourUTC, targetMinuteUTC, targetSecondUTC);
