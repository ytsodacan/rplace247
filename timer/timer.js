// NEW: Define the timezone offset of your event's 'local' time
// This variable tells the script what timezone your `eventHourLocal`, etc., are in.
// Examples:
//   For AEST (Australian Eastern Standard Time, UTC+10), use 10.
//   For BST (British Summer Time, UTC+1), use 1.
//   For EDT (Eastern Daylight Time, UTC-4), use -4.
//   For UTC/GMT itself, use 0.
const eventTimezoneOffsetHoursFromUTC = 10; // For AEST (Australian Eastern Standard Time)

// time settings (These are your desired LOCAL time settings for the event,
// relative to the 'eventTimezoneOffsetHoursFromUTC' above)
const eventMonthLocal = 7; // Month is 1-indexed (e.g., 7 for July)
const eventDayLocal = 8;
const eventYearLocal = 2025;
const eventHourLocal = 9;  // 9 AM
const eventMinuteLocal = 0;
const eventSecondLocal = 0;
// end time settings


// --- IMPORTANT: Calculate the UTC components based on the local time and its offset ---
// We create a temporary UTC Date object using the *local time components* and then
// subtract the offset to effectively get the true UTC time.
// JavaScript's Date.UTC() function is crucial here.

const tempDateForCalculation = new Date(Date.UTC(
    eventYearLocal,
    eventMonthLocal - 1, // Month is 0-indexed for Date.UTC() (July is 6)
    eventDayLocal,
    eventHourLocal - eventTimezoneOffsetHoursFromUTC, // Subtract the offset to get UTC hour
    eventMinuteLocal,
    eventSecondLocal
));

// Now, extract the actual UTC components from this calculated date object.
// This handles any day/month/year rollovers that occur from subtracting the offset.
const targetYearUTC = tempDateForCalculation.getUTCFullYear();
const targetMonthUTC = tempDateForCalculation.getUTCMonth(); // Already 0-indexed UTC month
const targetDayUTC = tempDateForCalculation.getUTCDate();
const targetHourUTC = tempDateForCalculation.getUTCHours();
const targetMinuteUTC = tempDateForCalculation.getUTCMinutes();
const targetSecondUTC = tempDateForCalculation.getUTCSeconds();
// --- END IMPORTANT CONVERSION ---


function createCountdown(
    // Parameters for this function are now strictly UTC values
    utcYear,
    utcMonthIndex, // This is 0-indexed (0 for Jan, 11 for Dec)
    utcDay,
    utcHour = 0,
    utcMinute = 0,
    utcSecond = 0
) {
    const second = 1000,
        minute = second * 60,
        hour = minute * 60,
        day = hour * 24;

    // Define the target date/time using Date.UTC() for universal consistency.
    // This creates a timestamp that is the same absolute moment for everyone.
    let countdownDate = Date.UTC(
        utcYear,
        utcMonthIndex, // Use the 0-indexed UTC month directly
        utcDay,
        utcHour,
        utcMinute,
        utcSecond
    );

    // Auto-adjust to next year if the UTC target for the current UTC year has already passed.
    // This ensures it always counts down to the *next* occurrence if the year isn't explicitly fixed.
    const nowMs = new Date().getTime(); // Current time in milliseconds (UTC timestamp)
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


    const x = setInterval(function () {
        const currentNowMs = new Date().getTime(); // Current time in milliseconds (UTC timestamp)
        const distance = countdownDate - currentNowMs;

        // Calculate and display remaining time
        // These calculations operate on the universal 'distance'
        document.getElementById("days").innerText = Math.floor(distance / day);
        document.getElementById("hours").innerText = Math.floor((distance % day) / hour);
        document.getElementById("minutes").innerText = Math.floor((distance % hour) / minute);
        document.getElementById("seconds").innerText = Math.floor((distance % minute) / second);

        // Do something when the countdown finishes
        if (distance < 0) {
            document.getElementById("headline").innerText = "It's here!"; // Customize this message
            document.getElementById("countdown").style.display = "none";
            document.getElementById("content").style.display = "block";
            clearInterval(x);
        }
    }, 0);
}

// --- CALL THE FUNCTION WITH THE CALCULATED UTC VALUES ---
// This will start the countdown that hits zero at the exact same universal moment for everyone.
createCountdown(targetYearUTC, targetMonthUTC, targetDayUTC, targetHourUTC, targetMinuteUTC, targetSecondUTC);