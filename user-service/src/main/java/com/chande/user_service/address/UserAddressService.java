package com.chande.user_service.address;

import com.chande.user_service.address.dto.AddressRequest;
import com.chande.user_service.address.dto.AddressResponse;
import com.chande.user_service.common.exception.ApiException;
import com.chande.user_service.common.exception.ErrorCode;
import com.chande.user_service.user.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.RoundingMode;
import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class UserAddressService {
    private final UserAddressRepository addressRepository;
    private final UserRepository userRepository;
    private static final int MAX_ADDRESSES = 10;

    @Transactional(readOnly = true)
    public List<AddressResponse> list(UUID userId){
        return addressRepository.findAllByUserIdOrderByDefaultAddressDescCreatedAtDesc(userId)
                .stream()
                .map(AddressResponse::from)
                .toList();
    }
    @Transactional
    public AddressResponse create(UUID userId, AddressRequest addressRequest){
        long count = addressRepository.countByUserId(userId);
        if( count >= MAX_ADDRESSES ){
            throw new ApiException(ErrorCode.ADDRESS_LIMIT_REACHED);
        }

        boolean makeDefault = count == 0 || Boolean.TRUE.equals(addressRequest.makeDefault());
        if (makeDefault) {
            addressRepository.clearDefaultByUserId(userId);
        }

        UserAddress address = new UserAddress();
        address.setUser(userRepository.getReferenceById(userId));
        applyFields(address, addressRequest);
        address.setDefaultAddress(makeDefault);
        return AddressResponse.from(addressRepository.save(address));

    }

    private void applyFields(UserAddress address, AddressRequest request){
        String label = request.label();
        address.setLabel(label == null || label.isBlank() ? null : label.trim());
        address.setAddressText(request.addressText().trim());
        address.setLat(request.lat().setScale(8, RoundingMode.HALF_UP));
        address.setLng(request.lng().setScale(8, RoundingMode.HALF_UP));

    }

    private UserAddress findOwned(UUID userId, UUID addressId){
        return addressRepository.findByIdAndUserId(addressId, userId)
                .orElseThrow(() -> new ApiException(ErrorCode.ADDRESS_NOT_FOUND));
    }

    @Transactional
    public AddressResponse update(UUID userId, UUID addressId, AddressRequest request){
        boolean makeDefault = Boolean.TRUE.equals(request.makeDefault());

        if (makeDefault){
            addressRepository.clearDefaultByUserId(userId);
        }
        UserAddress address = findOwned(userId, addressId);
        applyFields(address, request);

        if (makeDefault) {
            address.setDefaultAddress(true);
        }

        return AddressResponse.from(address);
    }

    @Transactional
    public AddressResponse setDefault(UUID userId, UUID addressId){
        addressRepository.clearDefaultByUserId(userId);
        UserAddress address = findOwned(userId, addressId);
        address.setDefaultAddress(true);
        return AddressResponse.from(address);
    }

    @Transactional
    public void delete(UUID userId, UUID addressId) {
        UserAddress address = findOwned(userId, addressId);
        boolean wasDefault = address.isDefaultAddress();

        addressRepository.delete(address);
        addressRepository.flush();

        if (wasDefault) {
            addressRepository.findFirstByUserIdOrderByCreatedAtDesc(userId)
                    .ifPresent(next -> next.setDefaultAddress(true));
        }
    }

}
