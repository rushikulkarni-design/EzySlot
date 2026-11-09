from ultralytics import YOLO
import cv2

# Load YOLO model
model = YOLO("yolo11n.pt")

# Read parking image
image = cv2.imread("parking_test.jpg")

# Run YOLO
results = model(image)

# Draw detection boxes
result_image = results[0].plot()

# Display image
cv2.imshow("EzySlot - YOLO Test", result_image)

# Save result
cv2.imwrite("yolo_result.jpg", result_image)

# Wait for key press
cv2.waitKey(0)
cv2.destroyAllWindows()