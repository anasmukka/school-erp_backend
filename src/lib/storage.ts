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
 * Used as a legacy/direct Firebase Storage path for printing order attachments
 * when called directly (not via objectStorage.uploadObject which handles routing).
 *
 * NOTE: This function is the Firebase Storage leaf-implementation only.
 * It does NOT perform R2 routing. R2 routing is handled by objectStorage.ts.
 * Do NOT add a try/catch Firebase fallback in objectStorage.ts that calls this.
 */
export async function uploadPrintingDocument(
  file: File,
  folder = "printing-orders",
  onProgress?: (progressPercent: number) => void
): Promise<UploadedFileResult> {
  if (!storage) {
    throw new Error(
      "Firebase Storage is not initialized. " +
        "Check your Firebase configuration. " +
        "If you intended to use R2, ensure VITE_WORKER_URL is set."
    );
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
        console.error("Firebase Storage upload failed:", error);
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
