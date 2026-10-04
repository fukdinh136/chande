package com.chande.user_service.address;

import com.chande.user_service.address.dto.AddressRequest;
import com.chande.user_service.address.dto.AddressResponse;
import com.chande.user_service.common.security.CurrentUser;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/users/me/addresses")
public class UserAddressController {
    private final UserAddressService addressService;

    @GetMapping
    public List<AddressResponse> list(@AuthenticationPrincipal Jwt jwt) {
        return addressService.list(CurrentUser.id(jwt));
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public AddressResponse create(@AuthenticationPrincipal Jwt jwt,
                                  @Valid @RequestBody AddressRequest request) {
        return addressService.create(CurrentUser.id(jwt), request);
    }

    @PutMapping("/{addressId}")
    public AddressResponse update(@AuthenticationPrincipal Jwt jwt,
                                  @PathVariable UUID addressId,
                                  @Valid @RequestBody AddressRequest request) {
        return addressService.update(CurrentUser.id(jwt), addressId, request);
    }

    @PutMapping("/{addressId}/default")
    public AddressResponse setDefault(@AuthenticationPrincipal Jwt jwt,
                                      @PathVariable UUID addressId) {
        return addressService.setDefault(CurrentUser.id(jwt), addressId);
    }

    @DeleteMapping("/{addressId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal Jwt jwt,
                       @PathVariable UUID addressId) {
        addressService.delete(CurrentUser.id(jwt), addressId);
    }

}
