/*
 * Smart Farming Sensor System
 * Microcontroller: ESP8266 / NodeMCU (or Arduino Uno / Nano)
 * Sensors:
 *   - DHT11: Temperature & Humidity Sensor -> Pin D2
 *   - LDR (Light Dependent Resistor): Light Sensor -> Pin A0
 *   - LED: Grow Light Indicator / Control -> Pin D5
 * Baud Rate: 115200
 */

#include <DHT.h>

#define DHTPIN D2
#define DHTTYPE DHT11

const int LDR_PIN = A0;
const int LED_PIN = D5;

const int THRESHOLD = 700;

DHT dht(DHTPIN, DHTTYPE);

void setup() {
  Serial.begin(115200);

  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  dht.begin();

  Serial.println("Smart Farming Sensor System Started");
}

void loop() {
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

  // Automatic LED control
  if (lightValue < THRESHOLD) {
    digitalWrite(LED_PIN, LOW);   // LED ON (active low on some ESP boards or direct drive)
    Serial.println("Dark - LED ON");
  } else {
    digitalWrite(LED_PIN, HIGH);  // LED OFF
    Serial.println("Bright - LED OFF");
  }

  delay(2000);
}
