/*
 * AgriTwin Pro - Smart Farming Sensor & Actuation System
 * Microcontroller: ESP8266 / NodeMCU (or Arduino Uno / Nano)
 * Sensors & Actuators:
 *   - DHT11: Temperature & Humidity Sensor -> Pin D2 (GPIO 4)
 *   - LDR (Light Dependent Resistor): Light Sensor -> Pin A0 (ADC0)
 *   - LED: Grow Light Indicator / Actuator -> Pin D5 (GPIO 14)
 * Baud Rate: 115200
 * Features:
 *   - Non-blocking millis() telemetry timer (no CPU freeze)
 *   - Bi-directional serial command listener (CMD:LED_ON, CMD:LED_OFF, CMD:THRESHOLD:xxx)
 */

#include <DHT.h>

#define DHTPIN D2
#define DHTTYPE DHT11

const int LDR_PIN = A0;
const int LED_PIN = D5;

int threshold = 700;
bool manualOverride = false;
bool manualLedState = false;

DHT dht(DHTPIN, DHTTYPE);

unsigned long lastSensorReadTime = 0;
const unsigned long SENSOR_INTERVAL = 2000; // 2 seconds interval

void setup() {
  Serial.begin(115200);

  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW); // Initial LED state

  dht.begin();

  Serial.println("Smart Farming Sensor System Started (Bi-Directional)");
}

void handleIncomingSerialCommands() {
  while (Serial.available() > 0) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();

    if (cmd == "CMD:LED_ON") {
      manualOverride = true;
      manualLedState = true;
      digitalWrite(LED_PIN, LOW); // Active LOW ON for ESP8266
      Serial.println("ACK:LED_ON");
    } else if (cmd == "CMD:LED_OFF") {
      manualOverride = true;
      manualLedState = false;
      digitalWrite(LED_PIN, HIGH); // OFF
      Serial.println("ACK:LED_OFF");
    } else if (cmd == "CMD:AUTO") {
      manualOverride = false;
      Serial.println("ACK:AUTO_MODE");
    } else if (cmd.startsWith("CMD:THRESHOLD:")) {
      int newThresh = cmd.substring(14).toInt();
      if (newThresh > 0 && newThresh <= 1023) {
        threshold = newThresh;
        Serial.print("ACK:THRESHOLD_SET:");
        Serial.println(threshold);
      }
    }
  }
}

void loop() {
  // 1. Process real-time bidirectional commands from digital twin / laptop
  handleIncomingSerialCommands();

  // 2. Non-blocking sensor telemetry timer
  unsigned long currentTime = millis();
  if (currentTime - lastSensorReadTime >= SENSOR_INTERVAL) {
    lastSensorReadTime = currentTime;

    // Read temperature and humidity
    float temperature = dht.readTemperature();
    float humidity = dht.readHumidity();

    // Read light level
    int lightValue = analogRead(LDR_PIN);
    lightValue = constrain(lightValue, 0, 1023);

    // Display readings
    Serial.println("------------------------");

    if (isnan(temperature) || isnan(humidity)) {
      Serial.println("DHT11 reading failed!");
    } else {
      Serial.print("Temperature: ");
      Serial.print(temperature);
      Serial.println(" C");

      Serial.print("Humidity: ");
      Serial.print(humidity);
      Serial.println(" %");
    }

    Serial.print("Light Value: ");
    Serial.println(lightValue);

    // Automatic or manual LED control
    if (manualOverride) {
      if (manualLedState) {
        digitalWrite(LED_PIN, LOW);
        Serial.println("Manual - LED ON");
      } else {
        digitalWrite(LED_PIN, HIGH);
        Serial.println("Manual - LED OFF");
      }
    } else {
      if (lightValue < threshold) {
        digitalWrite(LED_PIN, LOW);   // LED ON
        Serial.println("Dark - LED ON");
      } else {
        digitalWrite(LED_PIN, HIGH);  // LED OFF
        Serial.println("Bright - LED OFF");
      }
    }
  }
}
