document.addEventListener('DOMContentLoaded', function() {
    const btnContinue = document.getElementById('btnContinue');
    const btnLogin = document.getElementById('btnLogin');
    const changeIdentity = document.getElementById('changeIdentity');
    
    const step1 = document.getElementById('step1');
    const step2 = document.getElementById('step2');
    const newToSection = document.getElementById('newToSection');
    
    const identityInput = document.getElementById('identity');
    const passwordInput = document.getElementById('password');
    const displayIdentity = document.getElementById('displayIdentity');
    
    const errorBox = document.getElementById('errorBox');
    const errorMessage = document.getElementById('errorMessage');

    // Mencegah submit saat enter di step 1
    identityInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            btnContinue.click();
        }
    });

    // Step 1: Lanjutkan (Continue)
    btnContinue.addEventListener('click', function() {
        const identityValue = identityInput.value.trim();
        
        if (!identityValue) {
            showError("Masukkan NIM, NIDN, atau Email Anda");
            identityInput.classList.add('input-error');
            identityInput.focus();
        } else {
            // Sembunyikan error jika ada
            hideError();
            identityInput.classList.remove('input-error');
            
            // Siapkan step 2
            displayIdentity.textContent = identityValue;
            
            // Ganti tampilan ke step 2
            step1.style.display = 'none';
            newToSection.style.display = 'none';
            step2.style.display = 'block';
            
            // Fokus ke input password
            passwordInput.focus();
        }
    });

    // Step 2: Ubah Identity (Change Identity)
    changeIdentity.addEventListener('click', function(e) {
        e.preventDefault();
        
        // Sembunyikan error
        hideError();
        passwordInput.classList.remove('input-error');
        passwordInput.value = ''; // Reset password
        
        // Kembali ke step 1
        step2.style.display = 'none';
        step1.style.display = 'block';
        newToSection.style.display = 'block';
        
        identityInput.focus();
    });

    // Step 2: Masuk (Login Submit)
    document.getElementById('loginForm').addEventListener('submit', function(e) {
        e.preventDefault();
        
        // Hanya proses jika sedang di step 2
        if (step2.style.display === 'block') {
            const passwordValue = passwordInput.value.trim();
            
            if (!passwordValue) {
                showError("Masukkan kata sandi Anda");
                passwordInput.classList.add('input-error');
                passwordInput.focus();
            } else {
                hideError();
                passwordInput.classList.remove('input-error');
                
                // Simulasi proses login
                const originalText = btnLogin.textContent;
                btnLogin.textContent = 'Memproses...';
                btnLogin.disabled = true;
                btnLogin.style.opacity = '0.7';
                
                setTimeout(() => {
                    alert("Berhasil login sebagai:\n" + identityInput.value);
                    // Reset setelah alert
                    btnLogin.textContent = originalText;
                    btnLogin.disabled = false;
                    btnLogin.style.opacity = '1';
                }, 800);
            }
        }
    });

    // Hapus pesan error saat mulai mengetik
    identityInput.addEventListener('input', function() {
        if (this.classList.contains('input-error')) {
            this.classList.remove('input-error');
            hideError();
        }
    });

    passwordInput.addEventListener('input', function() {
        if (this.classList.contains('input-error')) {
            this.classList.remove('input-error');
            hideError();
        }
    });

    // Helper functions untuk menampilkan error
    function showError(message) {
        errorMessage.textContent = message;
        errorBox.style.display = 'flex';
    }

    function hideError() {
        errorBox.style.display = 'none';
    }
});
