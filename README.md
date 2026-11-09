AI-Powered Smart Parking Management System: 🚗 EzySlot.

The intelligent parking management solution based on Computer Vision and YOLOv8.

EzySlot is a smart parking management solution that automates the process of detecting vehicles and monitoring the occupancy of parking slots using camera feeds, powered by artificial intelligence. It applies YOLOv8 model to detect vehicles and virtual parking-slot regions to calculate real-time parking availability.

The system is designed to enhance parking space utilization in parking lots by detecting available and occupied spaces using an intelligent computer vision pipeline.

---

## 📌 Project Overview

The traditional parking management systems typically require manual supervision, leading to inefficiency in space utilization and delays.

To overcome this, EzySlot resolves the problem with its two-step solution of object detection and virtual parking slot mapping to automate parking slot occupancy monitoring.

The system identifies the vehicles based on camera images, compares them with the defined parking slot areas and assigns each slot to one of three different states:

- 🟢 FREE - No vehicle detected in the Parking Slot.
- 🔴 **OCCUPIED** – A car is found in the parking position.
- ⚪ UNKNOWN – The system cannot be certain of the slot's status.

---

## ✨ Key Features

### 1. AI-Based Vehicle Detection
- Applies YOLOv8 for object detection of vehicles.
- Identifies the types of vehicles a driver has, (cars, buses, trucks, motorcycles).
- Processes camera footage using computer vision.

### 2. Virtual Parking Slot Detection
-Supports hand-created virtual parking-slot regions.
- Implements polygon overlap logic to correlate the identified vehicles and parking slots.
Reduces the need for the clear physical marking of parking slots.

### 3. Intelligent Occupancy Classification
- Indicates whether a parking slot is taken or free.
- Determines if a parking space is FREE, OCCUPIED or UNKNOWN.
- Provides visual occupancy information.

### 4. Visual Parking Monitoring
- Visualizes the parking slot status with overlays.
- Provides parking space occupancy information.
- Supplies the results of the detection after processing.

### 5. Backend API Integration
- Implements backend operations in FastAPI.
- Links computer vision processing and the frontend.
- Communicates parking detection and occupancy information via API.

### 6. Web-Based Interface
- React-based frontend.
- Interactive parking management interface.
- Clear and structured layout of parking information.

---

## 🛠️ Technology Stack

| Category | Technologies |
|---|---|
Version of the language | Python 3.x, JavaScript 1.x |
Frontend | React.js, HTML, CSS |
| Backend | FastAPI |
| Object Detection | YOLOv8 |
| Computer Vision | OpenCV |
AI / ML: Deep Learning, Computer Vision |
| API | REST API |
Version Control | Git, GitHub |

---

## ⚙️ System Workflow

The system receives camera footage and/or an alternative visual input.
YOLOv8 takes the input and identifies the vehicle.
This module is responsible for extracting the detected vehicle coordinates.
5. Virtual parking-slot polygons are compared to regions where vehicles may be detected.
5. Each parking space is controlled by the occupancy logic.
6. The results will be provided by the backend.
7. Parking availability and parking detection information is shown on the frontend.

---

## 🏗️ System Architecture

```text
       CAMERA / VIDEO INPUT
                |
                v
       YOLOv8 VEHICLE DETECTION
                |
                v
       VEHICLE COORDINATE EXTRACTION
                |
                v
       VIRTUAL PARKING SLOT MAPPING
                |
                v
       POLYGON OVERLAP ANALYSIS
                |
                v
       OCCUPANCY CLASSIFICATION
                |
                v
       FASTAPI BACKEND
                |
                v
       REACT FRONTEND
                |
                v
       PARKING STATUS DASHBOARD
```

---

## 📂 Project Structure

The example below is a sample structure. Modify to reflect the actual folders in the repository.

```text
EzySlot/
│
├── backend/
│   ├── main.py
│   ├── requirements.txt
│   └── ...
│
├── frontend/
│   ├── public/
│   ├── src/
│   ├── package.json
│   └── ...
│
├── .gitignore
├── README.md
└── .env.example
```

---

## 🚀 Installation and Setup

### Prerequisites

Be sure that you have the following installed:

- Python 3.10 or later
- Node.js and npm
- Git
- Visual Studio Code

Create a clone of the repository.Run the following to clone the repository.

```bash
git clone https://github.com/rushikulkarni-design/EzySlot.git

cd EzySlot
```

### Step 2: Backend Setup

Go to the “backend” folder:

```bash
cd backend
```

Create Virtual Environment:

```bash
python -m venv .venv
```

On Windows, use this command to turn on the environment:

```powershell
.venv\Scripts\activate
```

Install dependencies:

```bash
pip install -r requirements.txt
```

Run the FastAPI application with the true module to run the backend:

```bash
uvicorn main:app --reload
```

In case you are using some other module or application variable in your FastAPI application, change it to the one you are using.

### Step 3: Frontend Setup

Open another terminal:

```bash
cd frontend
```

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Use the command defined in the package.json in your project if you will be using a different start script.

---

## 🔐 Environment Configuration

Use the supplied .env.example files to make the required environment files.

Set up the back and front variables based on local configuration.

Be careful, do not enter API keys, passwords, access tokens or private information into GitHub.

---

## 🧠 Core Computer Vision Logic

EzySlot does both object detection and virtual mapping of the parking slots.

Vehicle Detection: YOLOv8 detects vehicles and outputs their bounding-box coordinates.

A set of pre-defined polygons represent each parking slot in the system (Slot Mapping).

Overlap Analysis: The system compares vehicle regions detected with parking-slot polygons.

Each parking space is classified as occupied or unoccupied based on the detection and overlap logic.

---

## 🎯 Applications

- Shopping malls
- Corporate offices
- Hospitals
- Residential societies
- Commercial parking facilities
- Educational institutions

---

## 🔮 Future Enhancements

- Built-in H.264 encryption support.- Support for built-in H.264 encryption.
- Automatic parking-slot allocation.
- Multi-camera parking monitoring.
- Advanced parking analytics, utilization reports.
- Number plate recognition.
- Parking reservation and booking.
- Monitoring and management from the cloud.

---

## 👨‍💻 Developer

**Rushi Kulkarni**

Fifth-year student in the field of Artificial Intelligence and Data Science Engineering.Student of 5th year in Artificial Intelligence and Data Science Engineering.

- GitHub: https://github.com/rushikulkarni-design
- LinkedIn: https://linkedin.com/in/rushi-kulkarni-5a80053

---

## 📄 License

This Project is being developed for educational and project demonstration purposes.

A formal, open-source license might be included to specify usage and distribution requirements.

---

If you're interested in this project, please give the repository a star!