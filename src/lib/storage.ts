import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { storage } from "@/lib/firebase";

export interface UploadedFileResult {
  downloadUrl: string;
  storagePath: string;
  fileName: string;
  fileSize: number;
}

/**
 * Uploads a document to Firebase Storage under a designated folder path.
 * Typically used for printing order attachments.
 */
export async function uploadPrintingDocument(
  file: File,
  folder = "printing-orders",
  onProgress?: (progressPercent: number) => void
): Promise<UploadedFileResult> {
  if (!storage) {
    throw new Error("Firebase Storage is not initialized. Check your Firebase configuration.");
  }

  // Sanitize filename to avoid weird URI characters
  const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const uniquePath = `${folder}/${Date.now()}_${cleanName}`;
  const storageRef = ref(storage, uniquePath);

  const uploadTask = uploadBytesResumable(storageRef, file, {
    contentType: file.type || "application/octet-stream",
    customMetadata: {
      originalName: file.name,
      uploadedAt: new Date().toISOString(),
    },
  });

  return new Promise((resolve, reject) => {
    uploadTask.on(
      "state_changed",
      (snapshot) => {
        if (onProgress && snapshot.totalBytes > 0) {
          const percent = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
          onProgress(percent);
        }
      },
      (error) => {
        console.error("Storage upload failed:", error);
        reject(error);
      },
      async () => {
        try {
          const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
          resolve({
            downloadUrl,
            storagePath: uniquePath,
            fileName: file.name,
            fileSize: file.size,
          });
        } catch (err) {
          reject(err);
        }
      }
    );
  });
}
