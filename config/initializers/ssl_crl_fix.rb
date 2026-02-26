# frozen_string_literal: true

# Workaround for OpenSSL 3.6+ CRL verification failure on macOS.
# See: https://github.com/ruby/openssl/issues/949
# Without this, Net::HTTP requests to e.g. ddragon.leagueoflegends.com fail with:
#   OpenSSL::SSL::SSLError (certificate verify failed (unable to get certificate CRL))
begin
  if defined?(OpenSSL::SSL::SSLContext::DEFAULT_PARAMS) &&
     OpenSSL::SSL::SSLContext::DEFAULT_PARAMS.key?(:verify_flags) &&
     OpenSSL::X509.const_defined?(:V_FLAG_CRL_CHECK) &&
     OpenSSL::X509.const_defined?(:V_FLAG_CRL_CHECK_ALL)
    flags = OpenSSL::X509::V_FLAG_CRL_CHECK_ALL | OpenSSL::X509::V_FLAG_CRL_CHECK
    OpenSSL::SSL::SSLContext::DEFAULT_PARAMS[:verify_flags] &= ~flags
  end
rescue StandardError
  # Ignore if OpenSSL structure differs (older Ruby/OpenSSL)
end
